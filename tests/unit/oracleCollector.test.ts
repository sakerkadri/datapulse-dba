import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OracleCollector, parseIntervalToSeconds } from "../../src/collectors/oracle/oracleCollector";
import { MockOracleDriver } from "../../src/collectors/mock/mockOracleDriver";
import {
  evaluateOracleRules,
  evaluateBufferCache,
  evaluateRedoLogSwitching,
  evaluatePdbCpuSkew,
  evaluateAsmDiskgroupSpace,
  evaluateDataGuardLag,
  buildDeterministicOracleFallback,
  buildOracleGeminiPrompt,
} from "../../src/diagnostics/rules/oracleRules";
import type { OracleConnectionConfig } from "../../src/types/oracle";

describe("OracleCollector Unit & Domain Test Suite", () => {
  let mockDriver: MockOracleDriver;
  let collector: OracleCollector;
  let baseConfig: OracleConnectionConfig;

  beforeEach(() => {
    mockDriver = new MockOracleDriver("HEALTHY_CDB");
    baseConfig = {
      host: "ora-primary-01.corp.internal",
      port: 1521,
      serviceName: "ORCLCDB",
      user: "c##datapulse_mon",
      isMock: true,
      mockScenario: "HEALTHY_CDB",
    };
    collector = new OracleCollector(baseConfig, mockDriver);
  });

  describe("Tier 1: Multitenant (CDB/PDB) & Standalone Topology Introspection", () => {
    it("should accurately parse CDB multitenant topology, open mode, and uptime", async () => {
      const telemetry = await collector.collect();

      assert.strictEqual(telemetry.status, "ONLINE");
      assert.strictEqual(telemetry.isCdb, true);
      assert.strictEqual(telemetry.cdbName, "ORCLCDB");
      assert.strictEqual(telemetry.instanceName, "orclcdb1");
      assert.strictEqual(telemetry.archivelogMode, "ARCHIVELOG");
      assert.ok(telemetry.info);
      assert.strictEqual(telemetry.info.databaseRole, "PRIMARY");
      assert.strictEqual(telemetry.info.openMode, "READ WRITE");
      assert.strictEqual(telemetry.info.version, "19.22.0.0.0");
      assert.ok(telemetry.info.uptimeSeconds > 0);
    });

    it("should gracefully handle Non-CDB Standalone topologies", async () => {
      mockDriver.setScenario("STANDALONE_NON_CDB");
      const standaloneCollector = new OracleCollector(
        { ...baseConfig, serviceName: "ORCLSTD", mockScenario: "STANDALONE_NON_CDB" },
        mockDriver
      );

      const telemetry = await standaloneCollector.collect();

      assert.strictEqual(telemetry.status, "ONLINE");
      assert.strictEqual(telemetry.isCdb, false);
      assert.strictEqual(telemetry.cdbName, undefined);
      assert.strictEqual(telemetry.instanceName, "orclnoncdb1");
      assert.strictEqual(telemetry.info?.databaseRole, "PRIMARY");
      assert.strictEqual(telemetry.info?.version, "21.3.0.0.0");
      assert.deepStrictEqual(telemetry.pdbs, []);
      assert.ok(telemetry.tablespaces.length > 0);
      assert.ok(telemetry.tablespaces.every((t) => t.conId === 0));
    });

    it("should parse PDB slicing, CPU percentage, and active sessions for all user containers", async () => {
      const telemetry = await collector.collect();

      assert.ok(Array.isArray(telemetry.pdbs));
      assert.strictEqual(telemetry.pdbs.length, 3); // Seed excluded from active tenant grid

      const finPdb = telemetry.pdbs.find((p) => p.pdbName === "PDB_FINANCE");
      assert.ok(finPdb, "PDB_FINANCE must exist");
      assert.strictEqual(finPdb.conId, 3);
      assert.strictEqual(finPdb.openMode, "READ WRITE");
      assert.strictEqual(finPdb.restricted, false);
      assert.strictEqual(finPdb.totalSizeGb, 450.5);
      assert.strictEqual(finPdb.cpuSlicePct, 44.8);
      assert.strictEqual(finPdb.activeSessions, 38);
      assert.strictEqual(finPdb.totalSessions, 120);
      assert.strictEqual(finPdb.iops, 2400);

      const salesPdb = telemetry.pdbs.find((p) => p.pdbName === "PDB_SALES_CRM");
      assert.ok(salesPdb, "PDB_SALES_CRM must exist");
      assert.strictEqual(salesPdb.conId, 4);
      assert.strictEqual(salesPdb.activeSessions, 142);
      assert.strictEqual(salesPdb.cpuSlicePct, 28.2);

      const auditPdb = telemetry.pdbs.find((p) => p.pdbName === "PDB_AUDIT_LOGS");
      assert.ok(auditPdb, "PDB_AUDIT_LOGS must exist");
      assert.strictEqual(auditPdb.conId, 5);
      assert.strictEqual(auditPdb.cpuSlicePct, 12.5);
    });
  });

  describe("Tier 1: Dynamic Memory (SGA / PGA) & Cache Mathematical Precision", () => {
    it("should parse SGA dynamic pools and accurately convert bytes to MB", async () => {
      const telemetry = await collector.collect();

      assert.ok(telemetry.sga);
      assert.strictEqual(telemetry.sga.totalSgaMb, 32768); // 32 GB
      assert.strictEqual(telemetry.sga.bufferCacheMb, 20480); // 20 GB
      assert.strictEqual(telemetry.sga.sharedPoolMb, 8192); // 8 GB
      assert.strictEqual(telemetry.sga.largePoolMb, 1024); // 1 GB
      assert.strictEqual(telemetry.sga.javaPoolMb, 512); // 512 MB
      assert.strictEqual(telemetry.sga.freeSgaMb, 2048); // 2 GB
      assert.strictEqual(telemetry.sga.redoBufferMb, 64);
      assert.strictEqual(telemetry.sga.streamsPoolMb, 256);
      assert.strictEqual(telemetry.sga.sharedPoolFreePct, 25.0); // (2048 / 8192) * 100
    });

    it("should compute buffer cache hit ratio with 2 decimal precision", async () => {
      const telemetry = await collector.collect();

      assert.ok(telemetry.sga);
      assert.strictEqual(telemetry.sga.bufferCacheHitRatio, 99.4);
    });

    it("should parse PGA aggregate stats, allocation, and cache hit percentage", async () => {
      const telemetry = await collector.collect();

      assert.ok(telemetry.pga);
      assert.strictEqual(telemetry.pga.pgaTargetMb, 16384); // 16 GB
      assert.strictEqual(telemetry.pga.pgaAllocatedMb, 12288); // 12 GB
      assert.strictEqual(telemetry.pga.pgaInUseMb, 9216); // 9 GB
      assert.strictEqual(telemetry.pga.pgaFreeableMb, 2048); // 2 GB
      assert.strictEqual(telemetry.pga.pgaCacheHitRatio, 98.4);
      assert.strictEqual(telemetry.pga.autoPgaEnabled, true);
      assert.strictEqual(telemetry.pga.overAllocationCount, 0);
    });
  });

  describe("Tier 1: Storage, Redo Logs, ASM Diskgroups & Tablespaces", () => {
    it("should parse tablespaces, allocated/used MB, and autoextend headroom", async () => {
      const telemetry = await collector.collect();

      assert.ok(Array.isArray(telemetry.tablespaces));
      assert.ok(telemetry.tablespaces.length >= 4);

      const sysTs = telemetry.tablespaces.find((t) => t.tablespaceName === "SYSTEM");
      assert.ok(sysTs);
      assert.strictEqual(sysTs.totalMb, 2048);
      assert.strictEqual(sysTs.usedMb, 1820);
      assert.strictEqual(sysTs.freeMb, 228);
      assert.strictEqual(sysTs.maxSizeMb, 32768);
      assert.strictEqual(sysTs.autoextensible, true);

      const finData = telemetry.tablespaces.find((t) => t.tablespaceName === "FIN_DATA");
      assert.ok(finData);
      assert.strictEqual(finData.totalMb, 256000);
      assert.strictEqual(finData.usedMb, 198000);
      assert.strictEqual(finData.freeMb, 58000);
      assert.strictEqual(finData.maxSizeMb, 512000);
      assert.strictEqual(finData.usedPct, 38.67);
      assert.strictEqual(finData.freePct, 61.3);
    });

    it("should parse redo log switch frequency and 24-hour history buckets", async () => {
      const telemetry = await collector.collect();

      assert.ok(telemetry.redoLogs);
      assert.strictEqual(telemetry.redoLogs.switchesLastHour, 4);
      assert.strictEqual(telemetry.redoLogs.switchesLast6h, 20);
      assert.strictEqual(telemetry.redoLogs.switchesLast24h, 80);
      assert.strictEqual(telemetry.redoLogs.avgSwitchesPerHour, 3.33);
      assert.strictEqual(telemetry.redoLogs.redoLogGroups, 3);
      assert.strictEqual(telemetry.redoLogs.redoLogMemberSizeMb, 1024);
      assert.strictEqual(telemetry.redoLogs.currentLogSequence, 48292);
      assert.ok(Array.isArray(telemetry.redoLogs.last24HoursHistory));
      assert.strictEqual(telemetry.redoLogs.last24HoursHistory.length, 24);
    });

    it("should parse ASM diskgroups, capacity, and mirror redundancy", async () => {
      const telemetry = await collector.collect();

      assert.strictEqual(telemetry.asmEnabled, true);
      assert.ok(Array.isArray(telemetry.asmDiskgroups));
      assert.strictEqual(telemetry.asmDiskgroups.length, 2);

      const dataDg = telemetry.asmDiskgroups.find((d) => d.name === "DATA");
      assert.ok(dataDg);
      assert.strictEqual(dataDg.type, "NORMAL");
      assert.strictEqual(dataDg.totalMb, 2097152); // 2 TB
      assert.strictEqual(dataDg.freeMb, 629145);
      assert.strictEqual(dataDg.usedPct, 70.0);
      assert.strictEqual(dataDg.freePct, 30.0);
      assert.strictEqual(dataDg.offlineDisks, 0);
      assert.strictEqual(dataDg.state, "MOUNTED");
      assert.strictEqual(dataDg.votingFiles, true);

      const recoDg = telemetry.asmDiskgroups.find((d) => d.name === "RECO");
      assert.ok(recoDg);
      assert.strictEqual(recoDg.totalMb, 1048576); // 1 TB
      assert.strictEqual(recoDg.usedPct, 60.0);
    });
  });

  describe("Tier 1: Background Processes, Wait Classes & Data Guard Replication", () => {
    it("should monitor all critical background processes", async () => {
      const telemetry = await collector.collect();

      assert.ok(telemetry.backgroundProcesses);
      assert.strictEqual(telemetry.backgroundProcesses.pmon, "RUNNING");
      assert.strictEqual(telemetry.backgroundProcesses.smon, "RUNNING");
      assert.strictEqual(telemetry.backgroundProcesses.dbwr, "RUNNING");
      assert.strictEqual(telemetry.backgroundProcesses.lgwr, "RUNNING");
      assert.strictEqual(telemetry.backgroundProcesses.ckpt, "RUNNING");
      assert.strictEqual(telemetry.backgroundProcesses.mmon, "RUNNING");
      assert.strictEqual(telemetry.backgroundProcesses.arch, "RUNNING");
    });

    it("should parse and sort top wait classes and events excluding idle time", async () => {
      const telemetry = await collector.collect();

      assert.ok(Array.isArray(telemetry.waitClasses));
      assert.ok(telemetry.waitClasses.length > 0);
      assert.strictEqual(telemetry.waitClasses[0].waitClass, "System I/O");
      assert.ok(telemetry.waitClasses[0].pctTime > 0);
      assert.ok(telemetry.waitClasses[0].color);

      assert.ok(Array.isArray(telemetry.topWaitEvents));
      assert.ok(telemetry.topWaitEvents.length > 0);
      assert.strictEqual(telemetry.topWaitEvents[0].event, "db file sequential read");
      assert.strictEqual(telemetry.topWaitEvents[0].waitClass, "System I/O");
      assert.strictEqual(telemetry.topWaitEvents[0].avgWaitMs, 1.95);
    });

    it("should parse Data Guard status, protection mode, and replication lag", async () => {
      const telemetry = await collector.collect();

      assert.ok(telemetry.dataGuard);
      assert.strictEqual(telemetry.dataGuard.enabled, true);
      assert.strictEqual(telemetry.dataGuard.configured, true);
      assert.strictEqual(telemetry.dataGuard.protectionMode, "MAXIMUM AVAILABILITY");
      assert.strictEqual(telemetry.dataGuard.status, "SYNCHRONIZED");
      assert.strictEqual(telemetry.dataGuard.applyLagSeconds, 0);
      assert.strictEqual(telemetry.dataGuard.transportLagSeconds, 0);
      assert.strictEqual(telemetry.dataGuard.gapStatus, "NONE");
    });
  });

  describe("Tier 2: Interval String Parsing & Mathematical Boundary Cases", () => {
    it("should parse various Oracle Data Guard interval strings accurately", () => {
      assert.strictEqual(parseIntervalToSeconds("+00 00:00:00.000"), 0);
      assert.strictEqual(parseIntervalToSeconds("+00 00:05:45"), 345);
      assert.strictEqual(parseIntervalToSeconds("+00 00:32:45.100"), 1965);
      assert.strictEqual(parseIntervalToSeconds("+01 02:30:15"), 95415); // 1 day, 2 hrs, 30 min, 15 sec
      assert.strictEqual(parseIntervalToSeconds("00:01:30"), 90);
      assert.strictEqual(parseIntervalToSeconds(""), 0);
      assert.strictEqual(parseIntervalToSeconds(undefined), 0);
      assert.strictEqual(parseIntervalToSeconds("invalid-string"), 0);
    });

    it("should handle scenario transitions cleanly in MockOracleDriver", async () => {
      // 1. High Log Switch Scenario
      mockDriver.setScenario("HIGH_LOG_SWITCH");
      const highLogTelemetry = await collector.collect();
      assert.strictEqual(highLogTelemetry.redoLogs.switchesLastHour, 28);
      assert.strictEqual(highLogTelemetry.sga.bufferCacheHitRatio, 89.2);

      // 2. Data Guard Lag Scenario
      mockDriver.setScenario("DATA_GUARD_LAG");
      const lagTelemetry = await collector.collect();
      assert.strictEqual(lagTelemetry.info?.databaseRole, "PHYSICAL STANDBY");
      assert.strictEqual(lagTelemetry.dataGuard.status, "APPLY_LAG");
      assert.strictEqual(lagTelemetry.dataGuard.applyLagSeconds, 345); // 5 min 45 sec
      assert.strictEqual(lagTelemetry.dataGuard.transportLagSeconds, 48);
      assert.strictEqual(lagTelemetry.dataGuard.gapStatus, "UNRESOLVED");

      // 3. Tablespace Full Scenario
      mockDriver.setScenario("TABLESPACE_FULL");
      const fullTelemetry = await collector.collect();
      const salesTs = fullTelemetry.tablespaces.find((t) => t.tablespaceName === "SALES_DATA");
      assert.ok(salesTs);
      assert.strictEqual(salesTs.usedPct, 95.7);
      assert.strictEqual(salesTs.autoextensible, false);

      const asmData = fullTelemetry.asmDiskgroups.find((d) => d.name === "DATA");
      assert.ok(asmData);
      assert.strictEqual(asmData.usedPct, 95.8);
      assert.strictEqual(asmData.freePct, 4.2);
    });

    it("should detect PDB CPU starvation under PDB_STARVATION scenario", async () => {
      mockDriver.setScenario("PDB_STARVATION");
      const telemetry = await collector.collect();

      const finPdb = telemetry.pdbs?.find((p) => p.pdbName === "PDB_FINANCE");
      assert.ok(finPdb);
      assert.strictEqual(finPdb.cpuSlicePct, 88.5);
      assert.strictEqual(finPdb.cpuWaitingSec, 28.5);
      assert.strictEqual(finPdb.avgWaitingSessions, 4.2);
    });
  });

  describe("Tier 3: Rule-Based AI Diagnostics Evaluation (ORCL-01 to ORCL-05)", () => {
    it("ORCL-01: should trigger Warning and Critical for low Buffer Cache Hit Ratio", () => {
      const normalResult = evaluateBufferCache({ sga: { bufferCacheHitRatio: 99.2 } as any });
      assert.strictEqual(normalResult.triggered, false);
      assert.strictEqual(normalResult.severity, "OK");

      const warnResult = evaluateBufferCache({ sga: { bufferCacheHitRatio: 88.5 } as any });
      assert.strictEqual(warnResult.triggered, true);
      assert.strictEqual(warnResult.severity, "WARNING");
      assert.ok(warnResult.remediationSql.length > 0);

      const critResult = evaluateBufferCache({ sga: { bufferCacheHitRatio: 74.2 } as any });
      assert.strictEqual(critResult.triggered, true);
      assert.strictEqual(critResult.severity, "CRITICAL");
    });

    it("ORCL-02: should trigger on excessive redo log switch frequency", () => {
      const normalResult = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 3 } as any });
      assert.strictEqual(normalResult.triggered, false);

      const warnResult = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 8 } as any });
      assert.strictEqual(warnResult.triggered, true);
      assert.strictEqual(warnResult.severity, "WARNING");

      const critResult = evaluateRedoLogSwitching({ redoLogs: { switchesLastHour: 24 } as any });
      assert.strictEqual(critResult.triggered, true);
      assert.strictEqual(critResult.severity, "CRITICAL");
      assert.ok(critResult.remediationSql.some((s) => s.includes("ADD LOGFILE")));
    });

    it("ORCL-03: should detect PDB CPU skew and noisy neighbors in CDB", () => {
      const reportCdb = evaluatePdbCpuSkew({
        isCdb: true,
        pdbs: [
          { conId: 3, pdbName: "PDB_FINANCE", cpuSlicePct: 89.4, avgWaitingSessions: 3.5 } as any,
          { conId: 4, pdbName: "PDB_SALES", cpuSlicePct: 10.2, avgWaitingSessions: 0 } as any,
        ],
      });
      assert.strictEqual(reportCdb.triggered, true);
      assert.strictEqual(reportCdb.severity, "CRITICAL");
      assert.ok(reportCdb.remediationSql.some((s) => s.includes("DBMS_RESOURCE_MANAGER")));

      const reportNonCdb = evaluatePdbCpuSkew({ isCdb: false, pdbs: [] });
      assert.strictEqual(reportNonCdb.triggered, false);
    });

    it("ORCL-04: should detect ASM diskgroup storage exhaustion", () => {
      const healthyDg = evaluateAsmDiskgroupSpace({
        asmEnabled: true,
        asmDiskgroups: [{ name: "+DATA", freePct: 35.0, usableFileMb: 50000 } as any],
      });
      assert.strictEqual(healthyDg.triggered, false);

      const critDg = evaluateAsmDiskgroupSpace({
        asmEnabled: true,
        asmDiskgroups: [{ name: "+DATA", freePct: 3.8, usableFileMb: 0 } as any],
      });
      assert.strictEqual(critDg.triggered, true);
      assert.strictEqual(critDg.severity, "CRITICAL");
      assert.ok(critDg.remediationSql.some((s) => s.includes("ALTER DISKGROUP")));
    });

    it("ORCL-05: should detect Data Guard replication lag and redo gap", () => {
      const synced = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 0, transportLagSeconds: 0, gapStatus: "NONE" } as any,
      });
      assert.strictEqual(synced.triggered, false);

      const lagAlert = evaluateDataGuardLag({
        dataGuard: { enabled: true, configured: true, applyLagSeconds: 420, transportLagSeconds: 65, gapStatus: "UNRESOLVED" } as any,
      });
      assert.strictEqual(lagAlert.triggered, true);
      assert.strictEqual(lagAlert.severity, "CRITICAL");
      assert.ok(lagAlert.summary.includes("active redo sequence gap"));
    });

    it("should evaluate comprehensive OracleDiagnosticReport and generate deterministic fallback", async () => {
      mockDriver.setScenario("HIGH_LOG_SWITCH");
      const telemetry = await collector.collect();
      const report = evaluateOracleRules(telemetry);

      assert.ok(report.findings.length === 5);
      assert.strictEqual(report.isCdb, true);
      assert.ok(report.overallHealth === "WARNING" || report.overallHealth === "CRITICAL");

      const fallback = buildDeterministicOracleFallback(telemetry, report);
      assert.ok(fallback.analysis.length > 50);
      assert.ok(fallback.recommendations.length > 0);
      assert.ok(fallback.suggestedSql.length > 0);

      const prompt = buildOracleGeminiPrompt(telemetry, report, { incidentContext: "High load spike" });
      assert.ok(prompt.includes("Senior Principal Oracle Certified Master DBA"));
      assert.ok(prompt.includes("Instance Name:"));
    });
  });

  describe("Tier 4: Fault Injection & Error Resilience", () => {
    it("should handle connection timeout (ORA-12541) gracefully", async () => {
      mockDriver.injectError(new Error("ORA-12541: TNS:no listener"));
      const result = await collector.collect();

      assert.strictEqual(result.status, "OFFLINE");
      assert.ok(result.error?.includes("ORA-12541"));
      assert.strictEqual(result.backgroundProcesses.pmon, "STOPPED");
    });

    it("should handle authentication failure (ORA-01017) without uncaught exception", async () => {
      mockDriver.injectError(new Error("ORA-01017: invalid username/password; logon denied"));
      const result = await collector.collect();

      assert.strictEqual(result.status, "OFFLINE");
      assert.ok(result.error?.includes("ORA-01017"));
    });

    it("should handle deadlock (ORA-00060) simulation", async () => {
      mockDriver.injectError(new Error("ORA-00060: deadlock detected while waiting for resource"));
      const result = await collector.collect();

      assert.strictEqual(result.status, "OFFLINE");
      assert.ok(result.error?.includes("ORA-00060"));
    });

    it("should handle tablespace full (ORA-01653) simulation", async () => {
      mockDriver.injectError(new Error("ORA-01653: unable to extend table APP.PAYMENTS by 8192 in tablespace DATA_TBS"));
      const result = await collector.collect();

      assert.strictEqual(result.status, "OFFLINE");
      assert.ok(result.error?.includes("ORA-01653"));
    });

    it("should execute 10 sequential collection runs rapidly without state degradation", async () => {
      const startTime = Date.now();
      for (let i = 0; i < 10; i++) {
        const t = await collector.collect();
        assert.strictEqual(t.status, "ONLINE");
      }
      const duration = Date.now() - startTime;
      assert.ok(duration < 2000, `Expected 10 iterations in <2000ms, took ${duration}ms`);
    });
  });
});
