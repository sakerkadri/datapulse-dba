import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DBInstance, DatabaseEngine } from "../../src/types/dba";
import { ParsedHostMetrics } from "../unit/hostParsers.test";

export interface HostMetrics {
  hostId: string;
  osType: "linux" | "windows";
  cpu: {
    usagePercent: number;
    cores?: number;
    loadAvg?: [number, number, number];
    iowaitPercent?: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
    swapUsedPercent?: number;
    availableBytes?: number;
  };
  disk: Array<{
    mount: string;
    totalBytes: number;
    usedBytes: number;
    usedPercent: number;
  }>;
  io?: {
    readIops: number;
    writeIops: number;
    utilPercent: number;
  };
  timestamp?: string;
}

export interface CorrelationAlert {
  ruleId:
    | "NOISY_NEIGHBOR_CPU"
    | "DB_QUERY_STORM"
    | "STORAGE_IOPS_BOTTLENECK"
    | "OS_MEMORY_SWAPPING"
    | "DISK_SPACE_EXHAUSTION";
  severity: "critical" | "warning" | "info";
  dbInstanceId: string;
  hostId: string;
  description: string;
  remediation: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * Cross-Layer Host-to-DB Correlation Engine
 */
export class HostDBCorrelationService {
  public evaluate(db: DBInstance, host?: HostMetrics | null): CorrelationAlert[] {
    if (!host) return [];
    const alerts: CorrelationAlert[] = [];
    const timestamp = new Date().toISOString();

    const hostCpu = host.cpu?.usagePercent ?? 0;
    const dbCpu = db.cpuUsage ?? 0;
    const hostMemUsedPct = host.memory?.usedPercent ?? 0;
    const hostSwapUsedPct = host.memory?.swapUsedPercent ?? 0;
    const iowaitPct = host.cpu?.iowaitPercent ?? 0;
    const ioUtil = host.io?.utilPercent ?? 0;
    const totalIops = (host.io?.readIops ?? 0) + (host.io?.writeIops ?? 0);
    const dbLatency = db.queryLatencyMs ?? 0;
    const dbHitRatio = db.bufferHitRatio ?? 100;
    const dbConns = db.activeConnections ?? 0;

    // 1. NOISY_NEIGHBOR_CPU
    // Host CPU saturated (>= 85%) while DB consumption is low (< 30% or db/host < 0.35)
    if (hostCpu >= 85.0 && (dbCpu < 30.0 || dbCpu / hostCpu < 0.35)) {
      const severity = hostCpu >= 95.0 ? "critical" : "warning";
      alerts.push({
        ruleId: "NOISY_NEIGHBOR_CPU",
        severity,
        dbInstanceId: db.id,
        hostId: host.hostId,
        description: `Host CPU saturation (${hostCpu}%) exceeds DB consumption (${dbCpu}%). External non-database process is starving compute.`,
        remediation: "Inspect host process table via SSH/WinRM (top, ps aux, Get-Process). Isolate DB using cgroups/CPU affinity.",
        timestamp,
        metadata: { hostCpu, dbCpu },
      });
    }

    // 2. DB_QUERY_STORM
    // Host CPU >= 80% and DB CPU >= 70% and (activeConns >= 20 or latency >= 100ms or Oracle PDB active sessions)
    const oraclePdbs = db.engineSpecific?.oracle?.pdbs || [];
    const maxPdbSessions = oraclePdbs.reduce((max, p) => Math.max(max, p.activeSessions || 0), 0);
    const topPdb = oraclePdbs.find((p) => (p.activeSessions || 0) === maxPdbSessions);

    if (hostCpu >= 80.0 && dbCpu >= 70.0 && (dbConns >= 20 || dbLatency >= 100.0 || maxPdbSessions >= 20)) {
      let pdbDetails = "";
      if (topPdb && topPdb.activeSessions >= 20) {
        pdbDetails = ` Primary tenant driver: PDB '${topPdb.pdbName}' with ${topPdb.activeSessions} active sessions.`;
      }

      alerts.push({
        ruleId: "DB_QUERY_STORM",
        severity: "critical",
        dbInstanceId: db.id,
        hostId: host.hostId,
        description: `Database query storm driving host CPU saturation (${hostCpu}%). Active connections (${dbConns}) and query latency (${dbLatency}ms) spiking.${pdbDetails}`,
        remediation: "Inspect top active queries in v$session / pg_stat_activity / sys.dm_exec_requests. Terminate rogue runaway queries or throttle connection pool.",
        timestamp,
        metadata: { hostCpu, dbCpu, activeConns: dbConns, queryLatencyMs: dbLatency, topPdb: topPdb?.pdbName },
      });
    }

    // 3. STORAGE_IOPS_BOTTLENECK
    // Host I/O util >= 80% or IOPS >= 3000 or iowait >= 20%, AND DB latency >= 100ms or Oracle I/O wait class
    const oracleWaitEvents = db.engineSpecific?.oracle?.topWaitEvents || [];
    const hasIoWaitEvent = oracleWaitEvents.some(
      (w) => w.waitClass === "System I/O" || w.waitClass === "User I/O" || w.event.includes("db file") || w.event.includes("log file sync")
    );

    if ((ioUtil >= 80.0 || totalIops >= 3000 || iowaitPct >= 20.0) && (dbLatency >= 100.0 || hasIoWaitEvent)) {
      alerts.push({
        ruleId: "STORAGE_IOPS_BOTTLENECK",
        severity: "critical",
        dbInstanceId: db.id,
        hostId: host.hostId,
        description: `Storage subsystem saturation (${ioUtil}% util, ${totalIops} IOPS, ${iowaitPct}% iowait) causing database I/O stalls and latency spikes (${dbLatency}ms).`,
        remediation: "Add missing composite indexes to reduce disk reads, tune SGA buffer cache / shared_buffers, or relocate redo logs to dedicated high-speed storage.",
        timestamp,
        metadata: { ioUtil, totalIops, iowaitPct, queryLatencyMs: dbLatency },
      });
    }

    // 4. OS_MEMORY_SWAPPING
    // Host memory used >= 90% (or swapUsedPercent >= 20%) AND DB buffer hit ratio < 90%
    if ((hostMemUsedPct >= 90.0 || hostSwapUsedPct >= 20.0) && dbHitRatio < 90.0) {
      alerts.push({
        ruleId: "OS_MEMORY_SWAPPING",
        severity: "critical",
        dbInstanceId: db.id,
        hostId: host.hostId,
        description: `Host memory pressure (${hostMemUsedPct}% used, ${hostSwapUsedPct}% swap) causing OS swapping and database buffer cache hit ratio degradation (${dbHitRatio}%).`,
        remediation: "Verify DB memory allocation (SGA+PGA or shared_buffers) does not exceed 75% physical RAM. Enable Linux HugePages or lock memory in RAM.",
        timestamp,
        metadata: { hostMemUsedPct, hostSwapUsedPct, bufferHitRatio: dbHitRatio },
      });
    }

    // 5. DISK_SPACE_EXHAUSTION
    // Host partition used >= 85% (warning) or >= 92% (critical), OR Oracle tablespace usedPct >= 90% (non-autoextensible), OR ASM free < 10%
    const disks = host.disk || [];
    for (const d of disks) {
      if (d.usedPercent >= 85) {
        const severity = d.usedPercent >= 92 ? "critical" : "warning";
        alerts.push({
          ruleId: "DISK_SPACE_EXHAUSTION",
          severity,
          dbInstanceId: db.id,
          hostId: host.hostId,
          description: `Host storage partition '${d.mount}' is nearing capacity (${d.usedPercent}% used). Risk of database write stalls.`,
          remediation: "Purge obsolete RMAN backups, truncate temp tables, expand filesystem volume, or add datafiles to alternate mount points.",
          timestamp,
          metadata: { mount: d.mount, usedPercent: d.usedPercent, totalBytes: d.totalBytes },
        });
      }
    }

    // Check Oracle tablespaces
    const tablespaces = db.engineSpecific?.oracle?.tablespaces || [];
    for (const ts of tablespaces) {
      if (ts.usedPct >= 90.0 && !ts.autoextensible) {
        alerts.push({
          ruleId: "DISK_SPACE_EXHAUSTION",
          severity: "critical",
          dbInstanceId: db.id,
          hostId: host.hostId,
          description: `Oracle non-autoextensible tablespace '${ts.tablespaceName}' is saturated (${ts.usedPct}% used). Imminent ORA-01653 failure.`,
          remediation: `ALTER TABLESPACE ${ts.tablespaceName} ADD DATAFILE SIZE 10G AUTOEXTEND ON;`,
          timestamp,
          metadata: { tablespace: ts.tablespaceName, usedPct: ts.usedPct },
        });
      }
    }

    // Check Oracle ASM diskgroups
    const asmDgs = db.engineSpecific?.oracle?.asmDiskgroups || [];
    for (const dg of asmDgs) {
      if (dg.freePct < 10.0) {
        alerts.push({
          ruleId: "DISK_SPACE_EXHAUSTION",
          severity: "critical",
          dbInstanceId: db.id,
          hostId: host.hostId,
          description: `Oracle ASM diskgroup '${dg.name}' has critically low free space (${dg.freePct}% free).`,
          remediation: `ALTER DISKGROUP ${dg.name.replace(/^\+/, "")} ADD DISK;`,
          timestamp,
          metadata: { diskgroup: dg.name, freePct: dg.freePct },
        });
      }
    }

    return alerts;
  }
}

describe("HostDbCorrelation Integration Test Suite", () => {
  const correlationService = new HostDBCorrelationService();

  const createBaseDbInstance = (engine: DatabaseEngine = "Oracle"): DBInstance => ({
    id: "db-inst-01",
    name: "Production DB",
    engine,
    version: "19.22.0.0.0",
    host: "srv-db-01.corp.internal",
    port: 1521,
    databaseName: "PRODDB",
    status: "ONLINE",
    uptimeSeconds: 864000,
    cpuUsage: 20.0,
    memoryUsage: 50.0,
    iops: 500,
    activeConnections: 15,
    maxConnections: 500,
    queryLatencyMs: 8.0,
    slowQueryCount: 0,
    diskFreeGb: 400,
    diskTotalGb: 1000,
    replicationLagSeconds: 0,
    bufferHitRatio: 99.2,
    deadlocksCount: 0,
    lastHealthCheck: new Date().toISOString(),
    engineSpecific: {},
  });

  const createBaseHostMetrics = (osType: "linux" | "windows" = "linux"): HostMetrics => ({
    hostId: "host-srv-01",
    osType,
    cpu: {
      usagePercent: 35.0,
      cores: 16,
      loadAvg: [1.2, 1.0, 0.8],
      iowaitPercent: 2.0,
    },
    memory: {
      totalBytes: 64 * 1024 * 1024 * 1024,
      usedBytes: 32 * 1024 * 1024 * 1024,
      freeBytes: 32 * 1024 * 1024 * 1024,
      usedPercent: 50.0,
      swapUsedPercent: 0,
    },
    disk: [
      { mount: "/", totalBytes: 100 * 1024 * 1024 * 1024, usedBytes: 40 * 1024 * 1024 * 1024, usedPercent: 40 },
      { mount: "/u01/app/oracle", totalBytes: 500 * 1024 * 1024 * 1024, usedBytes: 250 * 1024 * 1024 * 1024, usedPercent: 50 },
    ],
    io: {
      readIops: 250,
      writeIops: 250,
      utilPercent: 25.0,
    },
    timestamp: new Date().toISOString(),
  });

  describe("Suite 1: Core Correlation Rule Scenarios", () => {
    it("Scenario 1.1: NOISY_NEIGHBOR_CPU - Warning when Host CPU >= 85% and DB CPU < 30%", () => {
      const db = createBaseDbInstance("PostgreSQL");
      db.cpuUsage = 15.0;

      const host = createBaseHostMetrics("linux");
      host.cpu.usagePercent = 88.0;

      const alerts = correlationService.evaluate(db, host);
      assert.strictEqual(alerts.length, 1);
      assert.strictEqual(alerts[0].ruleId, "NOISY_NEIGHBOR_CPU");
      assert.strictEqual(alerts[0].severity, "warning");
      assert.ok(alerts[0].description.includes("88%"));
      assert.ok(alerts[0].description.includes("15%"));
    });

    it("Scenario 1.2: NOISY_NEIGHBOR_CPU - Critical escalation when Host CPU >= 95%", () => {
      const db = createBaseDbInstance("Oracle");
      db.cpuUsage = 10.0;

      const host = createBaseHostMetrics("linux");
      host.cpu.usagePercent = 98.0;

      const alerts = correlationService.evaluate(db, host);
      assert.strictEqual(alerts.length, 1);
      assert.strictEqual(alerts[0].ruleId, "NOISY_NEIGHBOR_CPU");
      assert.strictEqual(alerts[0].severity, "critical");
    });

    it("Scenario 1.3: DB_QUERY_STORM - Database driving host compute exhaustion", () => {
      const db = createBaseDbInstance("PostgreSQL");
      db.cpuUsage = 88.0;
      db.activeConnections = 45;
      db.queryLatencyMs = 280.0;

      const host = createBaseHostMetrics("linux");
      host.cpu.usagePercent = 92.0;

      const alerts = correlationService.evaluate(db, host);
      const queryStorm = alerts.find((a) => a.ruleId === "DB_QUERY_STORM");
      assert.ok(queryStorm);
      assert.strictEqual(queryStorm.severity, "critical");
      assert.ok(queryStorm.remediation.includes("Terminate rogue runaway queries"));
    });

    it("Scenario 1.4: DB_QUERY_STORM - Oracle CDB/PDB Multitenant identifying runaway tenant", () => {
      const db = createBaseDbInstance("Oracle");
      db.cpuUsage = 84.0;
      db.activeConnections = 50;
      db.queryLatencyMs = 150.0;
      db.engineSpecific = {
        oracle: {
          isCdb: true,
          pdbs: [
            { conId: 3, pdbName: "PDB_FINANCE", activeSessions: 38, cpuSlicePct: 75.0 } as any,
            { conId: 4, pdbName: "PDB_CRM", activeSessions: 4, cpuSlicePct: 9.0 } as any,
          ],
        } as any,
      };

      const host = createBaseHostMetrics("linux");
      host.cpu.usagePercent = 89.0;

      const alerts = correlationService.evaluate(db, host);
      const queryStorm = alerts.find((a) => a.ruleId === "DB_QUERY_STORM");
      assert.ok(queryStorm);
      assert.ok(queryStorm.description.includes("PDB_FINANCE"));
      assert.strictEqual(queryStorm.metadata?.topPdb, "PDB_FINANCE");
    });

    it("Scenario 1.5: STORAGE_IOPS_BOTTLENECK - High I/O saturation and database wait events", () => {
      const db = createBaseDbInstance("Oracle");
      db.queryLatencyMs = 320.0;
      db.engineSpecific = {
        oracle: {
          topWaitEvents: [
            { event: "db file sequential read", waitClass: "System I/O", avgWaitMs: 45.0 } as any,
          ],
        } as any,
      };

      const host = createBaseHostMetrics("linux");
      host.io = { readIops: 2500, writeIops: 1200, utilPercent: 94.0 };
      host.cpu.iowaitPercent = 28.0;

      const alerts = correlationService.evaluate(db, host);
      const ioAlert = alerts.find((a) => a.ruleId === "STORAGE_IOPS_BOTTLENECK");
      assert.ok(ioAlert);
      assert.strictEqual(ioAlert.severity, "critical");
      assert.ok(ioAlert.description.includes("94% util"));
    });

    it("Scenario 1.6: STORAGE_IOPS_BOTTLENECK - Redo log sync commit stalls", () => {
      const db = createBaseDbInstance("Oracle");
      db.queryLatencyMs = 120.0;
      db.engineSpecific = {
        oracle: {
          topWaitEvents: [
            { event: "log file sync", waitClass: "Commit", avgWaitMs: 38.0 } as any,
          ],
        } as any,
      };

      const host = createBaseHostMetrics("linux");
      host.io = { readIops: 800, writeIops: 800, utilPercent: 88.0 };

      const alerts = correlationService.evaluate(db, host);
      const ioAlert = alerts.find((a) => a.ruleId === "STORAGE_IOPS_BOTTLENECK");
      assert.ok(ioAlert);
      assert.ok(ioAlert.remediation.includes("relocate redo logs"));
    });

    it("Scenario 1.7: OS_MEMORY_SWAPPING - Host memory exhaustion degrading buffer cache", () => {
      const db = createBaseDbInstance("PostgreSQL");
      db.bufferHitRatio = 78.4; // Buffer hit degraded due to paging

      const host = createBaseHostMetrics("linux");
      host.memory.usedPercent = 96.0;
      host.memory.swapUsedPercent = 42.0;

      const alerts = correlationService.evaluate(db, host);
      const memAlert = alerts.find((a) => a.ruleId === "OS_MEMORY_SWAPPING");
      assert.ok(memAlert);
      assert.strictEqual(memAlert.severity, "critical");
      assert.ok(memAlert.description.includes("78.4%"));
      assert.ok(memAlert.remediation.includes("HugePages"));
    });

    it("Scenario 1.8: DISK_SPACE_EXHAUSTION - Warning and Critical on host mount points", () => {
      const db = createBaseDbInstance("MySQL");
      const host = createBaseHostMetrics("linux");
      host.disk = [
        { mount: "/", totalBytes: 100e9, usedBytes: 40e9, usedPercent: 40 },
        { mount: "/var/lib/mysql", totalBytes: 500e9, usedBytes: 440e9, usedPercent: 88 }, // Warning
        { mount: "/backup", totalBytes: 1000e9, usedBytes: 960e9, usedPercent: 96 },       // Critical
      ];

      const alerts = correlationService.evaluate(db, host);
      const diskAlerts = alerts.filter((a) => a.ruleId === "DISK_SPACE_EXHAUSTION");
      assert.strictEqual(diskAlerts.length, 2);

      const warn = diskAlerts.find((a) => a.severity === "warning");
      assert.ok(warn);
      assert.ok(warn.description.includes("/var/lib/mysql"));

      const crit = diskAlerts.find((a) => a.severity === "critical");
      assert.ok(crit);
      assert.ok(crit.description.includes("/backup"));
    });

    it("Scenario 1.9: DISK_SPACE_EXHAUSTION - Oracle non-autoextensible tablespace & ASM capacity", () => {
      const db = createBaseDbInstance("Oracle");
      db.engineSpecific = {
        oracle: {
          tablespaces: [
            { tablespaceName: "CRIT_DATA", usedPct: 94.5, autoextensible: false } as any,
          ],
          asmDiskgroups: [
            { name: "+DATA", freePct: 4.8 } as any,
          ],
        } as any,
      };

      const host = createBaseHostMetrics("linux");

      const alerts = correlationService.evaluate(db, host);
      const diskAlerts = alerts.filter((a) => a.ruleId === "DISK_SPACE_EXHAUSTION");
      assert.strictEqual(diskAlerts.length, 2);
      assert.ok(diskAlerts.some((a) => a.description.includes("CRIT_DATA")));
      assert.ok(diskAlerts.some((a) => a.description.includes("+DATA")));
    });
  });

  describe("Suite 2: Multi-Engine & Multi-OS Matrix Verification", () => {
    it("Matrix 2.1: Windows WinRM Host + SQL Server Engine Correlation", () => {
      const sqlServerDb = createBaseDbInstance("SQL Server");
      sqlServerDb.cpuUsage = 85.0;
      sqlServerDb.activeConnections = 60;
      sqlServerDb.queryLatencyMs = 210.0;
      sqlServerDb.engineSpecific = {
        tempDbContentionPct: 45.0,
        pageLifeExpectancySec: 120,
      };

      const winHost = createBaseHostMetrics("windows");
      winHost.cpu.usagePercent = 90.0;

      const alerts = correlationService.evaluate(sqlServerDb, winHost);
      assert.ok(alerts.some((a) => a.ruleId === "DB_QUERY_STORM"));
    });

    it("Matrix 2.2: Linux SSH Host + MySQL Engine Correlation", () => {
      const mysqlDb = createBaseDbInstance("MySQL");
      mysqlDb.bufferHitRatio = 82.0;
      mysqlDb.engineSpecific = {
        innodbBufferHitRatio: 82.0,
        tableLocksWaiting: 8,
      };

      const lnxHost = createBaseHostMetrics("linux");
      lnxHost.memory.usedPercent = 94.0;

      const alerts = correlationService.evaluate(mysqlDb, lnxHost);
      assert.ok(alerts.some((a) => a.ruleId === "OS_MEMORY_SWAPPING"));
    });
  });

  describe("Suite 3: Boundary Conditions, Clean State & Resilience", () => {
    it("Boundary 3.1: Clean healthy state produces 0 alerts", () => {
      const db = createBaseDbInstance("Oracle");
      const host = createBaseHostMetrics("linux");

      const alerts = correlationService.evaluate(db, host);
      assert.strictEqual(alerts.length, 0);
    });

    it("Boundary 3.2: Exact threshold boundaries (84.9% vs 85.0%)", () => {
      const db = createBaseDbInstance("Oracle");
      db.cpuUsage = 10.0;

      const hostBelow = createBaseHostMetrics("linux");
      hostBelow.cpu.usagePercent = 84.9;
      assert.strictEqual(correlationService.evaluate(db, hostBelow).length, 0);

      const hostAt = createBaseHostMetrics("linux");
      hostAt.cpu.usagePercent = 85.0;
      assert.strictEqual(correlationService.evaluate(db, hostAt).length, 1);
    });

    it("Boundary 3.3: Missing optional telemetry properties handles cleanly", () => {
      const db = createBaseDbInstance("PostgreSQL");
      const hostSparse: HostMetrics = {
        hostId: "sparse-host",
        osType: "linux",
        cpu: { usagePercent: 50.0 },
        memory: { totalBytes: 16e9, usedBytes: 8e9, freeBytes: 8e9, usedPercent: 50.0 },
        disk: [],
      };

      const alerts = correlationService.evaluate(db, hostSparse);
      assert.deepStrictEqual(alerts, []);
    });

    it("Boundary 3.4: Null or undefined host metrics returns empty array", () => {
      const db = createBaseDbInstance("Oracle");
      assert.deepStrictEqual(correlationService.evaluate(db, null), []);
      assert.deepStrictEqual(correlationService.evaluate(db, undefined), []);
    });
  });
});
