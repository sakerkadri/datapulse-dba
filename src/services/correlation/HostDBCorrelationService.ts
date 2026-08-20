import { DBInstance } from "../../types/dba";
import {
  CorrelationAlert,
  CorrelationEvidence,
  HostDiskMount,
  HostMetricsSnapshot,
  ParsedHostMetrics,
} from "../../types/host";

export class HostDBCorrelationService {
  /**
   * Evaluates cross-layer telemetry between a DBInstance and underlying HostMetricsSnapshot.
   * Classifies root causes across the 5 canonical anomaly rules.
   */
  public evaluate(
    db: DBInstance,
    host?: HostMetricsSnapshot | ParsedHostMetrics | any | null
  ): CorrelationAlert[] {
    if (!host) return [];
    const alerts: CorrelationAlert[] = [];
    const timestamp = new Date().toISOString();

    const hostId = host.hostId || (host as any).id || "unknown-host";

    // Normalize CPU
    const hostCpu =
      host.cpu?.usagePercent ??
      (host as ParsedHostMetrics).cpuUsagePct ??
      host.cpuUsagePct ??
      0;
    const dbCpu = db.cpuUsage ?? 0;

    // Normalize Memory
    const hostMemUsedPct = host.memory?.usedPercent ?? 0;
    const hostSwapUsedPct = host.memory?.swapUsedPercent ?? 0;

    // Normalize I/O
    const iowaitPct =
      host.cpu?.iowaitPercent ??
      (host as ParsedHostMetrics).cpuBreakdown?.iowaitPct ??
      0;
    const ioUtil = host.io?.utilPercent ?? (host.iopsTotal ? Math.min(100, Math.round((host.iopsTotal / 4000) * 100)) : 0);
    const totalIops =
      host.io?.totalIops ??
      host.iopsTotal ??
      ((host.io?.readIops ?? 0) + (host.io?.writeIops ?? 0));

    // Normalize DB metrics
    const dbLatency = db.queryLatencyMs ?? 0;
    const dbHitRatio = db.bufferHitRatio ?? (db.engineSpecific?.innodbBufferHitRatio ?? 100);
    const dbConns = db.activeConnections ?? 0;

    // -----------------------------------------------------------------------
    // RULE 1: NOISY_NEIGHBOR_CPU
    // Host CPU saturated (>= 85%) while DB consumption is low (< 30% or db/host < 0.35)
    // -----------------------------------------------------------------------
    if (hostCpu >= 85.0 && (dbCpu < 30.0 || (hostCpu > 0 && dbCpu / hostCpu < 0.35))) {
      const severity = hostCpu >= 95.0 ? "critical" : "warning";
      const nonDbCpu = Number((hostCpu - dbCpu).toFixed(1));
      alerts.push({
        id: `corr-noisy-${db.id}-${hostId}-${Date.now()}`,
        ruleId: "NOISY_NEIGHBOR_CPU",
        severity,
        rootCause: "Host CPU Saturation from Non-Database Processes",
        confidence: 94,
        dbInstanceId: db.id,
        hostId,
        description: `Host CPU saturation (${hostCpu}%) exceeds DB consumption (${dbCpu}%). External non-database process is starving compute.`,
        remediation: "Inspect host process table via SSH/WinRM (top, ps aux, Get-Process). Isolate DB using cgroups/CPU affinity.",
        recommendation: "Inspect host process table via SSH/WinRM (top, ps aux, Get-Process). Isolate DB using cgroups/CPU affinity.",
        evidence: {
          hostMetric: { name: "HOST_CPU_USAGE", value: hostCpu, unit: "%", threshold: 85.0 },
          dbMetric: { name: "DB_CPU_USAGE", value: dbCpu, unit: "%", threshold: 30.0 },
          details: { nonDbCpuPct: nonDbCpu },
        },
        metadata: { hostCpu, dbCpu, nonDbCpuPct: nonDbCpu },
        timestamp,
      });
    }

    // -----------------------------------------------------------------------
    // RULE 2: DB_QUERY_STORM
    // Both DB CPU and Host CPU high (Host >= 80%, DB >= 70%) with active connections, latency, or PDB sessions
    // -----------------------------------------------------------------------
    const oraclePdbs = db.engineSpecific?.oracle?.pdbs || [];
    const maxPdbSessions = oraclePdbs.reduce((max, p) => Math.max(max, p.activeSessions || 0), 0);
    const topPdb = oraclePdbs.find((p) => (p.activeSessions || 0) === maxPdbSessions);

    if (hostCpu >= 80.0 && dbCpu >= 70.0 && (dbConns >= 20 || dbLatency >= 100.0 || maxPdbSessions >= 20)) {
      let pdbDetails = "";
      if (topPdb && topPdb.activeSessions >= 20) {
        pdbDetails = ` Primary tenant driver: PDB '${topPdb.pdbName}' with ${topPdb.activeSessions} active sessions.`;
      }

      alerts.push({
        id: `corr-storm-${db.id}-${hostId}-${Date.now()}`,
        ruleId: "DB_QUERY_STORM",
        severity: "critical",
        rootCause: "Database Query Storm Driving CPU Saturation",
        confidence: 96,
        dbInstanceId: db.id,
        hostId,
        description: `Database query storm driving host CPU saturation (${hostCpu}%). Active connections (${dbConns}) and query latency (${dbLatency}ms) spiking.${pdbDetails}`,
        remediation: "Inspect top active queries in v$session / pg_stat_activity / sys.dm_exec_requests. Terminate rogue runaway queries or throttle connection pool.",
        recommendation: "Inspect top active queries in v$session / pg_stat_activity / sys.dm_exec_requests. Terminate rogue runaway queries or throttle connection pool.",
        evidence: {
          hostMetric: { name: "HOST_CPU_USAGE", value: hostCpu, unit: "%", threshold: 80.0 },
          dbMetric: { name: "DB_CPU_USAGE", value: dbCpu, unit: "%", threshold: 70.0 },
          details: { activeConnections: dbConns, queryLatencyMs: dbLatency, topPdb: topPdb?.pdbName },
        },
        metadata: { hostCpu, dbCpu, activeConns: dbConns, queryLatencyMs: dbLatency, topPdb: topPdb?.pdbName },
        timestamp,
      });
    }

    // -----------------------------------------------------------------------
    // RULE 3: STORAGE_IOPS_BOTTLENECK
    // Host disk queue/util high (util >= 80%, IOPS >= 3000, or iowait >= 20%) with DB latency >= 100ms or I/O wait events
    // -----------------------------------------------------------------------
    const oracleWaitEvents = db.engineSpecific?.oracle?.topWaitEvents || [];
    const hasIoWaitEvent = oracleWaitEvents.some(
      (w) =>
        w.waitClass === "System I/O" ||
        w.waitClass === "User I/O" ||
        w.event.includes("db file") ||
        w.event.includes("log file sync")
    );

    if ((ioUtil >= 80.0 || totalIops >= 3000 || iowaitPct >= 20.0) && (dbLatency >= 100.0 || hasIoWaitEvent)) {
      alerts.push({
        id: `corr-io-${db.id}-${hostId}-${Date.now()}`,
        ruleId: "STORAGE_IOPS_BOTTLENECK",
        severity: "critical",
        rootCause: "Storage Subsystem IOPS / IOWait Bottleneck",
        confidence: 91,
        dbInstanceId: db.id,
        hostId,
        description: `Storage subsystem saturation (${ioUtil}% util, ${totalIops} IOPS, ${iowaitPct}% iowait) causing database I/O stalls and latency spikes (${dbLatency}ms).`,
        remediation: "Add missing composite indexes to reduce disk reads, tune SGA buffer cache / shared_buffers, or relocate redo logs to dedicated high-speed storage.",
        recommendation: "Add missing composite indexes to reduce disk reads, tune SGA buffer cache / shared_buffers, or relocate redo logs to dedicated high-speed storage.",
        evidence: {
          hostMetric: { name: "HOST_IO_UTIL", value: ioUtil, unit: "%", threshold: 80.0 },
          dbMetric: { name: "DB_LATENCY", value: dbLatency, unit: "ms", threshold: 100.0 },
          details: { totalIops, iowaitPct },
        },
        metadata: { ioUtil, totalIops, iowaitPct, queryLatencyMs: dbLatency },
        timestamp,
      });
    }

    // -----------------------------------------------------------------------
    // RULE 4: OS_MEMORY_SWAPPING
    // Host memory pressure (RAM used >= 90% or swap used >= 15%) while DB buffer cache hit ratio < 90%
    // -----------------------------------------------------------------------
    if ((hostMemUsedPct >= 90.0 || hostSwapUsedPct >= 15.0) && dbHitRatio < 90.0) {
      alerts.push({
        id: `corr-swap-${db.id}-${hostId}-${Date.now()}`,
        ruleId: "OS_MEMORY_SWAPPING",
        severity: "critical",
        rootCause: "Host Memory Paging Evicting Database Buffer Cache",
        confidence: 93,
        dbInstanceId: db.id,
        hostId,
        description: `Host memory pressure (${hostMemUsedPct}% used, ${hostSwapUsedPct}% swap) causing OS swapping and database buffer cache hit ratio degradation (${dbHitRatio}%).`,
        remediation: "Verify DB memory allocation (SGA+PGA or shared_buffers) does not exceed 75% physical RAM. Enable Linux HugePages or lock memory in RAM.",
        recommendation: "Verify DB memory allocation (SGA+PGA or shared_buffers) does not exceed 75% physical RAM. Enable Linux HugePages or lock memory in RAM.",
        evidence: {
          hostMetric: { name: "HOST_SWAP_USED", value: hostSwapUsedPct, unit: "%", threshold: 15.0 },
          dbMetric: { name: "BUFFER_HIT_RATIO", value: dbHitRatio, unit: "%", threshold: 90.0 },
          details: { hostMemUsedPct },
        },
        metadata: { hostMemUsedPct, hostSwapUsedPct, bufferHitRatio: dbHitRatio },
        timestamp,
      });
    }

    // -----------------------------------------------------------------------
    // RULE 5: DISK_SPACE_EXHAUSTION
    // Host storage partition used >= 85% (warning) or >= 92% (critical), OR Oracle non-autoextensible tablespace >= 90%, OR Oracle ASM free < 10%
    // -----------------------------------------------------------------------
    const disks: HostDiskMount[] = host.disks || host.disk || [];
    for (const d of disks) {
      const usedPct = d.usedPercent ?? 0;
      const mountPoint = d.mountPoint ?? d.mount ?? "unknown";
      const totalBytes = d.totalBytes ?? (d.totalGb ? d.totalGb * 1024 * 1024 * 1024 : 0);

      if (usedPct >= 85) {
        const severity = usedPct >= 92 ? "critical" : "warning";
        alerts.push({
          id: `corr-disk-${db.id}-${mountPoint.replace(/[^a-zA-Z0-9]/g, "_")}-${Date.now()}`,
          ruleId: "DISK_SPACE_EXHAUSTION",
          severity,
          rootCause: "Host Storage Partition Approaching Exhaustion",
          confidence: 97,
          dbInstanceId: db.id,
          hostId,
          description: `Host storage partition '${mountPoint}' is nearing capacity (${usedPct}% used). Risk of database write stalls.`,
          remediation: "Purge obsolete RMAN backups, truncate temp tables, expand filesystem volume, or add datafiles to alternate mount points.",
          recommendation: "Purge obsolete backup archives / WAL logs, expand filesystem volume, or add storage devices to volume group.",
          evidence: {
            hostMetric: { name: "MOUNT_USED_PCT", value: usedPct, unit: "%", threshold: 85.0 },
            dbMetric: { name: "DB_DISK_FREE", value: db.diskFreeGb, unit: "GB" },
            details: { mountPoint, totalBytes },
          },
          metadata: { mount: mountPoint, usedPercent: usedPct, totalBytes },
          timestamp,
        });
      }
    }

    // Oracle Tablespaces (Non-autoextensible >= 90%)
    const tablespaces = db.engineSpecific?.oracle?.tablespaces || [];
    for (const ts of tablespaces) {
      if (ts.usedPct >= 90.0 && !ts.autoextensible) {
        alerts.push({
          id: `corr-ts-${db.id}-${ts.tablespaceName}-${Date.now()}`,
          ruleId: "DISK_SPACE_EXHAUSTION",
          severity: "critical",
          rootCause: "Oracle Non-Autoextensible Tablespace Capacity Saturation",
          confidence: 99,
          dbInstanceId: db.id,
          hostId,
          description: `Oracle non-autoextensible tablespace '${ts.tablespaceName}' is saturated (${ts.usedPct}% used). Imminent ORA-01653 failure.`,
          remediation: `ALTER TABLESPACE ${ts.tablespaceName} ADD DATAFILE SIZE 10G AUTOEXTEND ON;`,
          recommendation: `Execute: ALTER TABLESPACE ${ts.tablespaceName} ADD DATAFILE SIZE 10G AUTOEXTEND ON;`,
          evidence: {
            hostMetric: { name: "TABLESPACE_USED_PCT", value: ts.usedPct, unit: "%", threshold: 90.0 },
            dbMetric: { name: "AUTOEXTENSIBLE", value: "false", unit: "boolean" },
            details: { tablespace: ts.tablespaceName },
          },
          metadata: { tablespace: ts.tablespaceName, usedPct: ts.usedPct },
          timestamp,
        });
      }
    }

    // Oracle ASM Diskgroups (Free space < 10%)
    const asmDgs = db.engineSpecific?.oracle?.asmDiskgroups || [];
    for (const dg of asmDgs) {
      if (dg.freePct < 10.0) {
        alerts.push({
          id: `corr-asm-${db.id}-${dg.name.replace(/[^a-zA-Z0-9]/g, "_")}-${Date.now()}`,
          ruleId: "DISK_SPACE_EXHAUSTION",
          severity: "critical",
          rootCause: "Oracle ASM Diskgroup Space Critical Depletion",
          confidence: 98,
          dbInstanceId: db.id,
          hostId,
          description: `Oracle ASM diskgroup '${dg.name}' has critically low free space (${dg.freePct}% free).`,
          remediation: `ALTER DISKGROUP ${dg.name.replace(/^\+/, "")} ADD DISK;`,
          recommendation: `Execute: ALTER DISKGROUP ${dg.name.replace(/^\+/, "")} ADD DISK '/dev/oracleasm/disks/*';`,
          evidence: {
            hostMetric: { name: "ASM_FREE_PCT", value: dg.freePct, unit: "%", threshold: 10.0 },
            dbMetric: { name: "ASM_STATE", value: dg.state, unit: "string" },
            details: { diskgroup: dg.name },
          },
          metadata: { diskgroup: dg.name, freePct: dg.freePct },
          timestamp,
        });
      }
    }

    return alerts;
  }
}
