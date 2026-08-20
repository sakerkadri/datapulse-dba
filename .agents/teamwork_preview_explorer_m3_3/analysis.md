# Technical Architecture & Specification: Host-to-DB Correlation Engine & Server Infrastructure UI

**Author:** teamwork_preview_explorer_m3_3 (Explorer 3)  
**Milestone:** Milestone 3 — Agentless Server Infrastructure Monitoring & Host-to-DB Correlation  
**Status:** Completed Investigation & Comprehensive Architectural Design  
**Target Systems:** DataPulse DBA Sentinel — Backend Correlation Services, REST/SSE APIs & React 19 Frontend  

---

## 1. Executive Summary

This specification defines the complete technical architecture, mathematical rules, data structures, REST/SSE APIs, React UI components, and verification methods for:
1. **The Host-to-DB Correlation Engine (`HostDBCorrelationService`)**: An automated, deterministic cross-layer diagnostic engine that correlates host operating system metrics (Linux SSH and Windows WinRM/WMI snapshots) with multi-engine database metrics (PostgreSQL, MySQL, SQL Server, Oracle CDB/PDB) to classify the exact root cause of performance degradation across 5 core failure modes:
   - `NOISY_NEIGHBOR_CPU`: Host CPU saturated ($\ge 85\%$) while database CPU consumption is low ($< 30\%$ or DB/Host ratio $< 0.35$).
   - `DB_QUERY_STORM`: High database workload driving host saturation (Host CPU $\ge 80\%$, DB CPU $\ge 70\%$) with high active sessions, latency spikes, or runaway Oracle PDB tenant queries.
   - `STORAGE_IOPS_BOTTLENECK`: Host disk queue/utilization ($\ge 80\%-90\%$, total IOPS $\ge 3000$, or `iowait` $\ge 20\%$) causing database I/O stalls (latency $\ge 100\text{ms}$, System/User I/O wait events, redo log sync latency).
   - `OS_MEMORY_SWAPPING`: Host OS memory pressure / swap thrashing ($\ge 90\%$ RAM used, swap $\ge 15\%-20\%$) evicting database buffer cache / SGA pages (hit ratio $< 90\%$).
   - `DISK_SPACE_EXHAUSTION`: Host filesystem mount capacity ($\ge 85\%$ warning, $\ge 92\%$ critical), Oracle non-autoextensible tablespace ($\ge 90\%$), or Oracle ASM diskgroup free space ($< 10\%$).
2. **Server Infrastructure UI Components**:
   - `HostInfrastructureCard.tsx`: Dedicated host telemetry widget rendering CPU breakdown (user/system/iowait/steal), memory & swap allocation bars, filesystem mount capacity tables, and I/O rates.
   - `HostCorrelationBanner.tsx`: Cross-layer alert banner displaying root cause classifications, confidence scores (0–100%), side-by-side metric comparison (Host vs. DB), and one-click remediation guidance.
   - Integration into `CustomizableDashboard.tsx`, `DatabaseEngineMetrics.tsx`, and `DBAContext.tsx` with 60fps Recharts performance and real-time SSE streaming.

---

## 2. Codebase Structure & Architectural Baseline

### 2.1 Codebase Layout & Module Boundaries

The DataPulse DBA Sentinel workspace exhibits a clean separation of concerns across types, collectors, polling core, UI components, and test harnesses:

```
datapulse-dba/
├── src/
│   ├── types/
│   │   ├── dba.ts              # Core DBInstance, MetricPoint, IncidentAlert, ConnectionLog models
│   │   ├── oracle.ts           # Oracle SGA/PGA, CDB/PDB, ASM, Redo, Data Guard telemetry types
│   │   ├── polling.ts          # Cadence tiers, worker pools, circuit breakers, ring buffers
│   │   └── host.ts             # Host telemetry, parser contracts, and correlation types (To be unified)
│   ├── server/
│   │   ├── polling/            # BoundedWorkerPool, CircuitBreaker, TieredScheduler, RingBuffer, PollingEngine
│   │   └── host/               # LinuxHostCollector, WindowsHostCollector, Parsers, HostDBCorrelationService
│   ├── collectors/
│   │   ├── oracle/             # OracleCollector, queries
│   │   └── mock/               # MockOracleDriver
│   ├── diagnostics/rules/      # oracleRules.ts (ORCL-01 to ORCL-05)
│   ├── components/
│   │   ├── dashboard/          # CustomizableDashboard, DatabaseEngineMetrics, MetricCard, HostInfrastructureCard
│   │   ├── databases/          # DatabaseManager
│   │   ├── alerts/             # ThresholdAlertsManager
│   │   ├── ai/                 # AIDiagnosticModal
│   │   └── layout/             # Navbar, Sidebar, MobileNav
│   ├── context/
│   │   └── DBAContext.tsx      # Central React state, SSE stream consumer, offline simulation
│   └── mock/
│       └── dbaData.ts          # Preloaded instances for PG, MySQL, MSSQL, Oracle CDB/PDB
├── server.ts                   # Express backend: REST endpoints, SSE stream (/api/stream/telemetry), Gemini AI
└── tests/
    ├── unit/
    │   ├── oracleCollector.test.ts
    │   ├── oracleRules.test.ts
    │   ├── pollingEngine.test.ts
    │   └── hostParsers.test.ts
    ├── integration/
    │   ├── oracleIntegration.test.ts
    │   └── hostDbCorrelation.test.ts
    └── load/
        └── pollingLoad.test.ts
```

### 2.2 Current Test Suite Baseline
Execution of `npm test` (`npx tsx --test tests/**/*.test.ts`) verifies that **133 of 133 tests pass in ~2.1 seconds** across all existing unit, integration, and load suites.

---

## 3. Host-to-DB Correlation Engine (`HostDBCorrelationService`)

### 3.1 Data Contracts

```typescript
export interface HostDiskMount {
  filesystem: string;
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usedPercent: number;
  mountPoint: string;
}

export interface HostMetricsSnapshot {
  hostId: string;
  hostname?: string;
  osType: "linux" | "windows" | "LINUX" | "WINDOWS";
  cpu: {
    usagePercent: number;
    cores?: number;
    loadAvg?: [number, number, number] | { load1m: number; load5m: number; load15m: number };
    iowaitPercent?: number;
    userPercent?: number;
    systemPercent?: number;
    stealPercent?: number;
  };
  memory: {
    totalBytes?: number;
    usedBytes?: number;
    freeBytes?: number;
    totalGb?: number;
    usedGb?: number;
    availableGb?: number;
    usedPercent: number;
    swapTotalGb?: number;
    swapUsedGb?: number;
    swapUsedPercent?: number;
  };
  disk: HostDiskMount[] | Array<{
    mount: string;
    totalBytes?: number;
    usedBytes?: number;
    usedPercent: number;
  }>;
  io?: {
    readIops?: number;
    writeIops?: number;
    totalIops?: number;
    utilPercent?: number;
  };
  uptimeSeconds?: number;
  timestamp: string;
}

export interface CorrelationEvidence {
  hostMetric: {
    name: string;
    value: number | string;
    unit: string;
    threshold?: number;
  };
  dbMetric: {
    name: string;
    value: number | string;
    unit: string;
    threshold?: number;
  };
  details?: Record<string, any>;
}

export interface CorrelationAlert {
  id?: string;
  ruleId:
    | "NOISY_NEIGHBOR_CPU"
    | "DB_QUERY_STORM"
    | "STORAGE_IOPS_BOTTLENECK"
    | "OS_MEMORY_SWAPPING"
    | "DISK_SPACE_EXHAUSTION";
  severity: "critical" | "warning" | "info" | "CRITICAL" | "WARNING" | "INFO";
  rootCause: string;
  confidence: number; // 0 - 100%
  dbInstanceId: string;
  hostId: string;
  description: string;
  remediation: string;
  recommendation?: string;
  evidence?: CorrelationEvidence;
  metadata?: Record<string, any>;
  timestamp: string;
}
```

---

### 3.2 Detailed Diagnostic Decision Rules & Mathematical Formulas

```
                                  ┌─────────────────────────────────────────┐
                                  │      HOST & DATABASE METRIC EVALUATOR   │
                                  └────────────────────┬────────────────────┘
                                                       │
         ┌─────────────────────────────────────────────┼─────────────────────────────────────────────┐
         │                                             │                                             │
         ▼                                             ▼                                             ▼
┌──────────────────┐                         ┌──────────────────┐                          ┌──────────────────┐
│  CPU CORRELATION │                         │  I/O CORRELATION │                          │ MEMORY & STORAGE │
└────────┬─────────┘                         └────────┬─────────┘                          └────────┬─────────┘
         │                                             │                                             │
   ┌─────┴────────────────┐                      ┌─────┴──────────────┐                        ┌─────┴────────────────┐
   ▼                      ▼                      ▼                    ▼                        ▼                      ▼
[Host CPU >= 85%]   [Host CPU >= 80%]     [Host IO >= 80%     [Host IO Normal]          [Host Swap >= 15%      [Host Disk >= 85%
 [DB CPU < 30%]      [DB CPU >= 70%]       DB Wait/Latency]     [DB Normal]              DB Cache < 90%]        or ASM/TS < 10%]
   │                      │                      │                                             │                      │
   ▼                      ▼                      ▼                                             ▼                      ▼
NOISY_NEIGHBOR_CPU   DB_QUERY_STORM     STORAGE_IOPS_BOTTLENECK                           OS_MEMORY_SWAPPING    DISK_SPACE_EXHAUSTION
(External Saturation)(Internal Runaway) (Disk/SAN Contention)                             (Host Paging/Thrash)  (Capacity Exhaustion)
```

#### Rule 1: `NOISY_NEIGHBOR_CPU` (External Process CPU Starvation)
- **Mathematical Condition**:
  $$\text{Host CPU} \ge 85.0\% \quad \text{AND} \quad \left( \text{DB CPU} < 30.0\% \quad \text{OR} \quad \frac{\text{DB CPU}}{\text{Host CPU}} < 0.35 \right)$$
- **Severity**:
  - `critical` if $\text{Host CPU} \ge 95.0\%$
  - `warning` if $85.0\% \le \text{Host CPU} < 95.0\%$
- **Confidence**: $92\% - 96\%$
- **Diagnostic Root Cause**: External non-database processes (backup scripts, batch compression, noisy neighbor container, antivirus scan) are starving the database engine of CPU cycles.
- **Evidence**:
  - `hostMetric`: `HOST_CPU_USAGE` = $X\%$ (Threshold: $85\%$)
  - `dbMetric`: `DB_CPU_USAGE` = $Y\%$ (Threshold: $<30\%$)
  - `details`: Non-DB CPU Slice = $(X - Y)\%$.
- **Remediation**:
  - Linux: Run `top -c -b -n 1 | head -n 20` or `pidstat 1 5` over SSH to isolate top consuming PIDs. Bind database processes to isolated CPU cores using `taskset` or systemd cgroups (`CPUWeight=1000`).
  - Windows: Query `Get-Process | Sort-Object CPU -Descending | Select-Object -First 10` via WinRM. Adjust Windows Processor Scheduling to "Background Services".

#### Rule 2: `DB_QUERY_STORM` (Database Workload Saturation)
- **Mathematical Condition**:
  $$\text{Host CPU} \ge 80.0\% \quad \text{AND} \quad \text{DB CPU} \ge 70.0\% \quad \text{AND} \quad \left( \text{activeConnections} \ge 20 \;\lor\; \text{latencyMs} \ge 100.0 \;\lor\; \max(\text{PDB Sessions}) \ge 20 \right)$$
- **Severity**: `critical`
- **Confidence**: $95\%$
- **Diagnostic Root Cause**: Database workload is driving host CPU exhaustion due to query storms, unindexed sequential table scans, runaway Cartesian joins, or connection bursts. In multitenant Oracle, isolates the primary offending PDB container.
- **Evidence**:
  - `hostMetric`: `HOST_CPU_USAGE` = $X\%$
  - `dbMetric`: `DB_CPU_USAGE` = $Y\%$, Active Connections = $C$, Latency = $L\,\text{ms}$
  - `details`: Identified culprit PDB name and session count (if Oracle CDB).
- **Remediation**:
  - PostgreSQL: Query `SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 5;` and terminate rogue PIDs with `pg_terminate_backend(pid)`.
  - Oracle: Inspect `v$session` and `v$sqlarea` for top SQL with `CPU_TIME`. Apply SQL Profile or enable Resource Manager plan to cap tenant CPU (`UTILIZATION_LIMIT`).
  - SQL Server: Inspect `sys.dm_exec_requests` cross-applied with `sys.dm_exec_sql_text`.

#### Rule 3: `STORAGE_IOPS_BOTTLENECK` (Storage / SAN Throughput Contention)
- **Mathematical Condition**:
  $$\left( \text{Host I/O Util} \ge 80.0\% \;\lor\; \text{Total IOPS} \ge 3000 \;\lor\; \text{iowait} \ge 20.0\% \right) \quad \text{AND} \quad \left( \text{latencyMs} \ge 100.0 \;\lor\; \text{hasIoWaitEvent} \right)$$
  where $\text{hasIoWaitEvent}$ is true if Oracle Top Wait Events include `System I/O`, `User I/O`, `db file sequential read`, `db file scattered read`, or `log file sync` (Commit wait).
- **Severity**: `critical`
- **Confidence**: $90\% - 94\%$
- **Diagnostic Root Cause**: Underlying physical disk arrays, SAN LUNs, or Cloud EBS volumes have hit IOPS or throughput ceilings, causing database thread stalls during datafile block reads, redo log flushes, or checkpointing.
- **Evidence**:
  - `hostMetric`: `HOST_IOWAIT` = $W\%$, `HOST_IO_UTIL` = $U\%$, `IOPS` = $I$
  - `dbMetric`: `QUERY_LATENCY` = $L\,\text{ms}$, Wait Event = `event_name`
- **Remediation**:
  - Add missing composite indexes to eliminate full table scans and physical disk reads.
  - Tune buffer cache / `shared_buffers` to keep hot working sets in RAM.
  - Relocate high-frequency write targets (Redo logs, WAL segments, TempDB) to dedicated high-speed NVMe storage.

#### Rule 4: `OS_MEMORY_SWAPPING` (Host Memory Paging Degrading Buffer Pool)
- **Mathematical Condition**:
  $$\left( \text{Host Memory Used} \ge 90.0\% \;\lor\; \text{Host Swap Used} \ge 15.0\% \right) \quad \text{AND} \quad \text{DB Buffer Cache Hit Ratio} < 90.0\%$$
- **Severity**: `critical`
- **Confidence**: $92\%$
- **Diagnostic Root Cause**: Host OS physical RAM is depleted, causing the kernel memory manager to page out active database buffer cache memory pages to disk swap, resulting in buffer hit ratio collapse and heavy disk read latency.
- **Evidence**:
  - `hostMetric`: `HOST_RAM_USED` = $R\%$, `HOST_SWAP_USED` = $S\%$
  - `dbMetric`: `BUFFER_CACHE_HIT_RATIO` = $B\%$ (Threshold: $<90\%$)
- **Remediation**:
  - Set Linux `vm.swappiness = 1` or `10` (default 60 causes aggressive swapping).
  - Configure Linux HugePages (`vm.nr_hugepages`) and grant `hugetlb` memory to database service user to prevent buffer cache from ever being paged out.
  - Ensure total DB memory configuration (`SGA + PGA` or `shared_buffers + work_mem * max_connections`) does not exceed 75% of physical server RAM.

#### Rule 5: `DISK_SPACE_EXHAUSTION` (Tablespace & Filesystem Mount Saturation)
- **Mathematical Condition**:
  $$\text{Host Mount Used} \ge 85.0\% \quad \text{OR} \quad \text{Oracle Non-Autoextensible Tablespace} \ge 90.0\% \quad \text{OR} \quad \text{Oracle ASM Diskgroup Free Space} < 10.0\%$$
- **Severity**:
  - `critical` if $\text{Host Mount Used} \ge 92.0\%$, Tablespace $\ge 90\%$, or ASM Free $< 10\%$
  - `warning` if $85.0\% \le \text{Host Mount Used} < 92.0\%$
- **Confidence**: $98\%$
- **Diagnostic Root Cause**: Storage partition or database storage pool is on the verge of total exhaustion. Risk of immediate transaction aborts, read-only freeze, or instance crash (e.g. ORA-01653, out of disk space).
- **Evidence**:
  - `hostMetric`: Mount point / Tablespace name, `USED_PCT` = $U\%$, `FREE_GB` = $F\,\text{GB}$
  - `dbMetric`: Autoextensible flag, ASM usable free space.
- **Remediation**:
  - Purge obsolete archivelogs / RMAN backups: `RMAN> DELETE NOPROMPT OBSOLETE;`.
  - Expand host filesystem volume (LVM `lvextend -r`).
  - Add datafile with autoextension enabled: `ALTER TABLESPACE <TS> ADD DATAFILE SIZE 10G AUTOEXTEND ON MAXSIZE 100G;`.
  - Add storage LUNs to Oracle ASM diskgroup: `ALTER DISKGROUP <DG> ADD DISK '/dev/oracleasm/disks/DISK*';`.

---

### 3.3 Multi-Engine Correlation Mapping Matrix

| Database Engine | Engine-Specific Metrics Inspected | Correlated Host OS Signals | Target Correlation Rule |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | `cpuUsage`, `activeConnections`, `queryLatencyMs`, `walSizeMb`, `autovacuumRunning` | Host CPU%, IOWait%, Diskstats IOPS, `/proc/loadavg` | `NOISY_NEIGHBOR_CPU`, `DB_QUERY_STORM`, `STORAGE_IOPS_BOTTLENECK` |
| **PostgreSQL** | `bufferHitRatio` ($< 90\%$), `idleInTransaction` | Host MemTotal, MemAvailable, SwapUsed% | `OS_MEMORY_SWAPPING` |
| **MySQL / MariaDB** | `innodbBufferHitRatio` ($< 90\%$), `tableLocksWaiting`, `threadsConnected` | `/proc/meminfo` SwapUsed, Disk IOPS | `OS_MEMORY_SWAPPING`, `STORAGE_IOPS_BOTTLENECK` |
| **SQL Server** | `cpuUsage`, `tempDbContentionPct`, `pageLifeExpectancySec` ($< 300\text{s}$) | `Win32_PerfFormattedData_PerfOS_Processor`, `FreePhysicalMemory` | `DB_QUERY_STORM`, `OS_MEMORY_SWAPPING` |
| **SQL Server** | `batchRequestsPerSec`, `diskFreeGb` | `Win32_LogicalDisk (DriveType=3)` FreeSpace | `DISK_SPACE_EXHAUSTION` |
| **Oracle CDB/PDB** | `pdbs[].activeSessions`, `pdbs[].cpuSlicePct` | Host `/proc/stat` CPU user/system% | `DB_QUERY_STORM` (identifies runaway PDB) |
| **Oracle** | `topWaitEvents` (`System I/O`, `Commit` / `log file sync`, `db file sequential read`) | `/proc/diskstats`, Host `cpu.iowaitPercent` | `STORAGE_IOPS_BOTTLENECK` |
| **Oracle** | `sga.bufferCacheHitRatio` ($< 90\%$) | `/proc/meminfo` SwapUsed% | `OS_MEMORY_SWAPPING` |
| **Oracle** | `tablespaces[].usedPct` (non-autoextensible $\ge 90\%$), `asmDiskgroups[].freePct` ($< 10\%$) | Host `df -Pk` mount used% | `DISK_SPACE_EXHAUSTION` |

---

### 3.4 Production Service Implementation Contract

```typescript
// Path: src/server/host/HostDBCorrelationService.ts
import { DBInstance } from "../../types/dba";
import { HostMetricsSnapshot, CorrelationAlert, CorrelationEvidence } from "../../types/host";

export class HostDBCorrelationService {
  /**
   * Correlates database metrics snapshot with underlying host operating system telemetry.
   * Evaluates the 5 deterministic root-cause rules and returns active correlation alerts.
   */
  public evaluate(db: DBInstance, host?: HostMetricsSnapshot | null): CorrelationAlert[] {
    if (!host) return [];
    const alerts: CorrelationAlert[] = [];
    const timestamp = new Date().toISOString();

    const hostCpu = host.cpu?.usagePercent ?? 0;
    const dbCpu = db.cpuUsage ?? 0;
    const hostMemUsedPct = host.memory?.usedPercent ?? 0;
    const hostSwapUsedPct = host.memory?.swapUsedPercent ?? 0;
    const iowaitPct = host.cpu?.iowaitPercent ?? 0;
    const ioUtil = host.io?.utilPercent ?? 0;
    const totalIops = host.io?.totalIops ?? ((host.io?.readIops ?? 0) + (host.io?.writeIops ?? 0));
    const dbLatency = db.queryLatencyMs ?? 0;
    const dbHitRatio = db.bufferHitRatio ?? 100;
    const dbConns = db.activeConnections ?? 0;

    // -------------------------------------------------------------
    // RULE 1: NOISY_NEIGHBOR_CPU
    // -------------------------------------------------------------
    if (hostCpu >= 85.0 && (dbCpu < 30.0 || (hostCpu > 0 && dbCpu / hostCpu < 0.35))) {
      const severity = hostCpu >= 95.0 ? "critical" : "warning";
      alerts.push({
        id: `corr-noisy-${db.id}-${Date.now()}`,
        ruleId: "NOISY_NEIGHBOR_CPU",
        severity,
        rootCause: "Host CPU Saturation from Non-Database Processes",
        confidence: 94,
        dbInstanceId: db.id,
        hostId: host.hostId,
        description: `Host CPU saturation (${hostCpu}%) exceeds DB consumption (${dbCpu}%). External non-database process is starving compute.`,
        recommendation: "Inspect host process table via SSH/WinRM (top, ps aux, Get-Process). Isolate DB compute using OS cgroups/CPU affinity.",
        remediation: "Inspect host process table via SSH/WinRM (top, ps aux, Get-Process). Isolate DB using cgroups/CPU affinity.",
        evidence: {
          hostMetric: { name: "HOST_CPU_USAGE", value: hostCpu, unit: "%", threshold: 85.0 },
          dbMetric: { name: "DB_CPU_USAGE", value: dbCpu, unit: "%", threshold: 30.0 },
          details: { nonDbCpuPct: Number((hostCpu - dbCpu).toFixed(1)) },
        },
        metadata: { hostCpu, dbCpu },
        timestamp,
      });
    }

    // -------------------------------------------------------------
    // RULE 2: DB_QUERY_STORM
    // -------------------------------------------------------------
    const oraclePdbs = db.engineSpecific?.oracle?.pdbs || [];
    const maxPdbSessions = oraclePdbs.reduce((max, p) => Math.max(max, p.activeSessions || 0), 0);
    const topPdb = oraclePdbs.find((p) => (p.activeSessions || 0) === maxPdbSessions);

    if (hostCpu >= 80.0 && dbCpu >= 70.0 && (dbConns >= 20 || dbLatency >= 100.0 || maxPdbSessions >= 20)) {
      let pdbDetails = "";
      if (topPdb && topPdb.activeSessions >= 20) {
        pdbDetails = ` Primary tenant driver: PDB '${topPdb.pdbName}' with ${topPdb.activeSessions} active sessions.`;
      }

      alerts.push({
        id: `corr-storm-${db.id}-${Date.now()}`,
        ruleId: "DB_QUERY_STORM",
        severity: "critical",
        rootCause: "Database Query Storm Driving CPU Saturation",
        confidence: 96,
        dbInstanceId: db.id,
        hostId: host.hostId,
        description: `Database query storm driving host CPU saturation (${hostCpu}%). Active connections (${dbConns}) and query latency (${dbLatency}ms) spiking.${pdbDetails}`,
        recommendation: "Inspect active sessions in pg_stat_activity / v$session / sys.dm_exec_requests. Terminate runaway queries or throttle connection pools.",
        remediation: "Inspect top active queries in v$session / pg_stat_activity / sys.dm_exec_requests. Terminate rogue runaway queries or throttle connection pool.",
        evidence: {
          hostMetric: { name: "HOST_CPU_USAGE", value: hostCpu, unit: "%", threshold: 80.0 },
          dbMetric: { name: "DB_CPU_USAGE", value: dbCpu, unit: "%", threshold: 70.0 },
          details: { activeConnections: dbConns, queryLatencyMs: dbLatency, topPdb: topPdb?.pdbName },
        },
        metadata: { hostCpu, dbCpu, activeConns: dbConns, queryLatencyMs: dbLatency, topPdb: topPdb?.pdbName },
        timestamp,
      });
    }

    // -------------------------------------------------------------
    // RULE 3: STORAGE_IOPS_BOTTLENECK
    // -------------------------------------------------------------
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
        id: `corr-io-${db.id}-${Date.now()}`,
        ruleId: "STORAGE_IOPS_BOTTLENECK",
        severity: "critical",
        rootCause: "Storage Subsystem IOPS / IOWait Bottleneck",
        confidence: 91,
        dbInstanceId: db.id,
        hostId: host.hostId,
        description: `Storage subsystem saturation (${ioUtil}% util, ${totalIops} IOPS, ${iowaitPct}% iowait) causing database I/O stalls and latency spikes (${dbLatency}ms).`,
        recommendation: "Add missing composite indexes to reduce physical disk reads, tune buffer cache / shared_buffers, or relocate redo logs / WAL to NVMe storage.",
        remediation: "Add missing composite indexes to reduce disk reads, tune SGA buffer cache / shared_buffers, or relocate redo logs to dedicated high-speed storage.",
        evidence: {
          hostMetric: { name: "HOST_IO_UTIL", value: ioUtil, unit: "%", threshold: 80.0 },
          dbMetric: { name: "DB_LATENCY", value: dbLatency, unit: "ms", threshold: 100.0 },
          details: { totalIops, iowaitPct },
        },
        metadata: { ioUtil, totalIops, iowaitPct, queryLatencyMs: dbLatency },
        timestamp,
      });
    }

    // -------------------------------------------------------------
    // RULE 4: OS_MEMORY_SWAPPING
    // -------------------------------------------------------------
    if ((hostMemUsedPct >= 90.0 || hostSwapUsedPct >= 15.0) && dbHitRatio < 90.0) {
      alerts.push({
        id: `corr-swap-${db.id}-${Date.now()}`,
        ruleId: "OS_MEMORY_SWAPPING",
        severity: "critical",
        rootCause: "Host Memory Paging Evicting Database Buffer Cache",
        confidence: 93,
        dbInstanceId: db.id,
        hostId: host.hostId,
        description: `Host memory pressure (${hostMemUsedPct}% used, ${hostSwapUsedPct}% swap) causing OS swapping and database buffer cache hit ratio degradation (${dbHitRatio}%).`,
        recommendation: "Verify DB memory allocation (SGA+PGA or shared_buffers) does not exceed 75% physical RAM. Enable Linux HugePages or lock memory in RAM.",
        remediation: "Verify DB memory allocation (SGA+PGA or shared_buffers) does not exceed 75% physical RAM. Enable Linux HugePages or lock memory in RAM.",
        evidence: {
          hostMetric: { name: "HOST_SWAP_USED", value: hostSwapUsedPct, unit: "%", threshold: 15.0 },
          dbMetric: { name: "BUFFER_HIT_RATIO", value: dbHitRatio, unit: "%", threshold: 90.0 },
          details: { hostMemUsedPct },
        },
        metadata: { hostMemUsedPct, hostSwapUsedPct, bufferHitRatio: dbHitRatio },
        timestamp,
      });
    }

    // -------------------------------------------------------------
    // RULE 5: DISK_SPACE_EXHAUSTION
    // -------------------------------------------------------------
    const disks = host.disk || [];
    for (const d of disks) {
      const usedPct = (d as any).usedPercent ?? 0;
      const mountPoint = (d as any).mountPoint ?? (d as any).mount ?? "unknown";
      const totalBytes = (d as any).totalBytes ?? ((d as any).totalGb ? (d as any).totalGb * 1024 * 1024 * 1024 : 0);

      if (usedPct >= 85) {
        const severity = usedPct >= 92 ? "critical" : "warning";
        alerts.push({
          id: `corr-disk-${db.id}-${mountPoint.replace(/[^a-zA-Z0-9]/g, "_")}-${Date.now()}`,
          ruleId: "DISK_SPACE_EXHAUSTION",
          severity,
          rootCause: "Host Storage Partition Approaching Exhaustion",
          confidence: 97,
          dbInstanceId: db.id,
          hostId: host.hostId,
          description: `Host storage partition '${mountPoint}' is nearing capacity (${usedPct}% used). Risk of database write stalls.`,
          recommendation: "Purge obsolete backup archives / WAL logs, expand filesystem volume, or add storage devices to volume group.",
          remediation: "Purge obsolete RMAN backups, truncate temp tables, expand filesystem volume, or add datafiles to alternate mount points.",
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
          hostId: host.hostId,
          description: `Oracle non-autoextensible tablespace '${ts.tablespaceName}' is saturated (${ts.usedPct}% used). Imminent ORA-01653 failure.`,
          recommendation: `Execute: ALTER TABLESPACE ${ts.tablespaceName} ADD DATAFILE SIZE 10G AUTOEXTEND ON;`,
          remediation: `ALTER TABLESPACE ${ts.tablespaceName} ADD DATAFILE SIZE 10G AUTOEXTEND ON;`,
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
          hostId: host.hostId,
          description: `Oracle ASM diskgroup '${dg.name}' has critically low free space (${dg.freePct}% free).`,
          recommendation: `Execute: ALTER DISKGROUP ${dg.name.replace(/^\+/, "")} ADD DISK '/dev/oracleasm/disks/*';`,
          remediation: `ALTER DISKGROUP ${dg.name.replace(/^\+/, "")} ADD DISK;`,
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
```

---

## 4. Server Infrastructure UI Component Architecture

### 4.1 Component Hierarchy & Layout

```
CustomizableDashboard (src/components/dashboard/CustomizableDashboard.tsx)
├── HostCorrelationBanner (src/components/dashboard/HostCorrelationBanner.tsx)
│   ├── Root Cause Pill & Severity Badge (Critical/Warning)
│   ├── Side-by-side Evidence Cards (Host Metric vs. Database Metric)
│   ├── Confidence Score Meter (e.g. 96% Confidence)
│   └── One-Click Remediation & AI Diagnose Trigger
├── HostInfrastructureCard (src/components/dashboard/HostInfrastructureCard.tsx)
│   ├── Host System Header (OS Badge 🐧/🪟, Hostname, IP, Uptime)
│   ├── CPU Section (Usage Gauge, Breakdown: User/Sys/IOWait/Steal, Loadavg 1m/5m/15m)
│   ├── Memory Section (RAM Total/Used/Avail, Swap Used/Total, Progress Bar)
│   ├── Disks Table (Mount, Filesystem, Size, Used, Free, Capacity Bar)
│   └── I/O Performance (Total IOPS, Read/Write IOPS, Storage Util%)
└── DatabaseEngineMetrics (src/components/dashboard/DatabaseEngineMetrics.tsx)
    ├── Engine Tabs (PostgreSQL, SQL Server, MySQL, Oracle CDB/PDB)
    └── Host Mapping Cross-Link ("Hosted on srv-db-01.corp.internal")
```

### 4.2 Host Infrastructure Card Design (`HostInfrastructureCard.tsx`)

#### Key Visual Features:
1. **OS Indicator**: Visual badges distinguishing Linux (SSH agentless) and Windows (WinRM/WMI).
2. **CPU Core Slicing**: Displays total cores, load average breakdown ($1\text{m}, 5\text{m}, 15\text{m}$), and sub-tick breakdowns (User %, System %, IOWait %, Steal %).
3. **RAM & Swap Precision**: Explicit GB values with color thresholds:
   - Green: $< 75\%$
   - Yellow: $75\% - 90\%$
   - Red: $> 90\%$ (Triggers memory alert)
4. **Filesystem Mount Table**: Lists all fixed storage volumes (`/`, `/u01`, `/data`, `C:`, `D:`) with capacity bars, warning at $85\%$ and critical at $92\%$.
5. **Real-time Sparklines**: Uses Recharts `ResponsiveContainer` and `AreaChart` with `isAnimationActive={false}` to stream live 60fps CPU, RAM, and IOPS trends without memory leaks.

```typescript
// Component Signature
export interface HostInfrastructureCardProps {
  host: HostNode | HostMetricsSnapshot;
  correlationAlerts?: CorrelationAlert[];
  onOpenAiDiagnosis?: (context: any) => void;
}
```

### 4.3 Host-to-DB Correlation Banner Design (`HostCorrelationBanner.tsx`)

#### Key Visual Features:
1. **Alert Classification Pill**: Displays root cause badge (`NOISY_NEIGHBOR_CPU`, `DB_QUERY_STORM`, `STORAGE_IOPS_BOTTLENECK`, `OS_MEMORY_SWAPPING`, `DISK_SPACE_EXHAUSTION`).
2. **Evidence Comparison Layout**:
   ```
   ┌─────────────────────────────────┐   VS   ┌─────────────────────────────────┐
   │ 🖥️ HOST METRIC                  │        │ 🗄️ DATABASE METRIC              │
   │ CPU: 96.0% (Saturated)          │        │ DB CPU: 12.5% (Idle)            │
   │ IOWait: 2.1%                    │        │ Latency: 180ms (Throttled)      │
   └─────────────────────────────────┘        └─────────────────────────────────┘
   ```
3. **Confidence Meter**: Visual radial or bar indicator showing algorithm confidence ($90\% - 99\%$).
4. **Remediation Box**: Actionable shell commands or SQL scripts with a **Copy Command** button and an **AI Diagnose** button that opens `AIDiagnosticModal.tsx` pre-populated with cross-layer incident context.

### 4.4 60fps Recharts Optimization Compliance

Following the `react-dba-dashboard-optimization` skill:
1. **`isAnimationActive={false}`**: Applied on all live streaming chart components to eliminate transition calculation overhead on sub-second updates.
2. **Fixed Container Heights**: All `ResponsiveContainer` wrappers are enclosed in explicit pixel/Tailwind height wrappers (`h-48`, `h-64`).
3. **Ring Buffer Windowing**: Telemetry arrays in React state are strictly sliced to fixed window lengths ($N = 25 - 60$ points) via `appendMetricPoint()`.

---

## 5. Backend REST & SSE API Integration (`server.ts`)

### 5.1 Endpoint Specifications

| Method | Route | Description | Request / Query | Response Payload |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/hosts` | List all agentless host nodes with latest parsed metrics. | `?zone=us-east-1` | `HostNode[]` |
| `GET` | `/api/hosts/:id/telemetry` | Sliding window historical telemetry for a host. | `?limit=60` | `HostMetricsSnapshot[]` |
| `POST` | `/api/hosts/test-connection` | Verify SSH or WinRM credentials and connectivity. | `{ host, port, osType, authType, credentials }` | `{ success: boolean, latencyMs: number, osVersion: string, message: string }` |
| `GET` | `/api/correlations` | Active cross-layer Host-to-DB correlation anomaly reports. | `?databaseId=db-pg-01` | `CorrelationAlert[]` |
| `GET` | `/api/stream/telemetry` | Server-Sent Events (SSE) live telemetry stream. | `?targetId=ALL` | SSE Stream: `telemetry_delta`, `correlation_alert`, `host_telemetry` |

### 5.2 Server-Sent Events (SSE) Pipeline Integration

In `server.ts`, the `/api/stream/telemetry` endpoint broadcasts cross-layer events:
```typescript
// Correlation Alert Event Broadcast
const onCorrelationAlert = (alert: CorrelationAlert) => {
  if (targetId && targetId !== "ALL" && alert.dbInstanceId !== targetId) return;
  res.write(`event: correlation_alert\ndata: ${JSON.stringify(alert)}\n\n`);
};

// Host Telemetry Event Broadcast
const onHostTelemetry = (hostSample: HostMetricsSnapshot) => {
  res.write(`event: host_telemetry\ndata: ${JSON.stringify(hostSample)}\n\n`);
};

pollingEngine.on("correlation_alert", onCorrelationAlert);
pollingEngine.on("host_telemetry", onHostTelemetry);
```

---

## 6. React State & Live Streaming Integration (`DBAContext.tsx`)

### 6.1 State Model Additions

```typescript
interface DBAContextType {
  // Existing state...
  hosts: HostNode[];
  selectedHostId: string;
  setSelectedHostId: (id: string) => void;
  correlationAlerts: CorrelationAlert[];
  dismissCorrelationAlert: (id: string) => void;
  // Existing actions...
}
```

### 6.2 SSE Live Event Handling

```typescript
// Inside useEffect connectSSE() in DBAContext.tsx
es.addEventListener("correlation_alert", (event: MessageEvent) => {
  try {
    const alert: CorrelationAlert = JSON.parse(event.data);
    setCorrelationAlerts((prev) => {
      if (prev.some((a) => a.id === alert.id || (a.ruleId === alert.ruleId && a.dbInstanceId === alert.dbInstanceId))) {
        return prev;
      }
      return [alert, ...prev];
    });
  } catch (err) {
    console.warn("[SSE] Correlation alert parse error:", err);
  }
});

es.addEventListener("host_telemetry", (event: MessageEvent) => {
  try {
    const hostSample: HostMetricsSnapshot = JSON.parse(event.data);
    setHosts((prevHosts) =>
      prevHosts.map((h) => (h.id === hostSample.hostId ? { ...h, lastMetrics: hostSample } : h))
    );
  } catch (err) {
    console.warn("[SSE] Host telemetry parse error:", err);
  }
});
```

---

## 7. Verification & Test Strategy

### 7.1 Test Matrix

| Suite | Target | Test Cases |
| :--- | :--- | :--- |
| **Unit: `hostParsers.test.ts`** | Linux SSH `/proc` & Windows WMI parsers | CPU tick delta arithmetic, legacy `MemAvailable` fallback, `df -Pk` multi-mount parsing, `loadavg`, diskstats IOPS, WMI `DriveType=3` filtering, WMI LastBootUpTime date parsing. (Currently passing). |
| **Integration: `hostDbCorrelation.test.ts`** | `HostDBCorrelationService` 5 rules | Scenario 1.1–1.2: `NOISY_NEIGHBOR_CPU` (Warning & Critical escalation)<br>Scenario 1.3–1.4: `DB_QUERY_STORM` (Postgres & Oracle PDB session tracking)<br>Scenario 1.5–1.6: `STORAGE_IOPS_BOTTLENECK` (I/O wait & redo log sync stalls)<br>Scenario 1.7: `OS_MEMORY_SWAPPING` (Memory pressure & buffer hit degradation)<br>Scenario 1.8–1.9: `DISK_SPACE_EXHAUSTION` (Host mount capacity & Oracle tablespace/ASM)<br>Suite 2: Multi-Engine & Multi-OS Matrix (WinRM + SQL Server, SSH + MySQL)<br>Suite 3: Boundary conditions (84.9% vs 85.0%), sparse telemetry, null handling. (Currently passing). |

---

## 8. Implementation Plan & Checklist for Sub-Orchestrator

1. **Step 1: Unified Type Declarations**
   - Create/export unified `HostMetrics`, `HostMetricsSnapshot`, `HostDiskMount`, `CorrelationAlert`, `CorrelationEvidence` in `src/types/host.ts` and re-export from `src/types/dba.ts`.
2. **Step 2: Backend Correlation Service**
   - Place production `HostDBCorrelationService.ts` in `src/server/host/HostDBCorrelationService.ts`.
   - Ensure complete backward-compatibility with `tests/integration/hostDbCorrelation.test.ts`.
3. **Step 3: Backend REST & SSE Routing**
   - Implement `/api/hosts`, `/api/hosts/:id/telemetry`, and `/api/correlations` in `server.ts`.
   - Wire `correlation_alert` and `host_telemetry` to SSE stream.
4. **Step 4: Frontend UI Components**
   - Implement `HostInfrastructureCard.tsx` and `HostCorrelationBanner.tsx` in `src/components/dashboard/`.
   - Integrate `HostCorrelationBanner` and `HostInfrastructureCard` into `CustomizableDashboard.tsx`.
   - Update `DBAContext.tsx` with host state, correlation alerts, and SSE listeners.
5. **Step 5: Full Verification**
   - Run `npm test` and ensure 100% tests pass.
   - Verify TypeScript compilation via `npm run lint` (`tsc --noEmit`).
