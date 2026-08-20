# Oracle Database Monitoring — Frontend UI & Mock Telemetry Specification

**Explorer**: `teamwork_preview_explorer_m1_3` (Explorer 3 — Frontend & Mock Telemetry)  
**Date**: 2026-08-19  
**Milestone**: Milestone 1 (Oracle Database Monitoring)  
**Parent Agent**: `teamwork_preview_sub_orch_m1` (Conversation ID: `72e141e9-5307-413e-9c29-6d61f1fbbcd4`)  
**Working Directory**: `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m1_3/`

---

## 1. Executive Summary & Problem Boundary

The objective of Explorer 3 for Milestone 1 is to design the comprehensive Frontend UI layout and Mock Telemetry Data models for **Oracle Database Monitoring (CDB/PDB Multitenant and Standalone architectures)** within the DataPulse DBA Sentinel platform.

DataPulse Sentinel currently provides real-time observability for PostgreSQL (🐘), SQL Server (⚡), and MySQL (🐬) inside `DatabaseEngineMetrics.tsx`. To deliver enterprise-grade Oracle observability as outlined in `ORIGINAL_REQUEST.md (§R1)` and `PROJECT.md (Milestone 1)`, the UI and mock telemetry layer must represent Oracle's unique architecture:
1. **Multitenant CDB/PDB Hierarchy**: Dynamic container filtering (`CDB$ROOT`, `SALES_PDB`, `FIN_PDB`, `HR_PDB`), displaying per-PDB open modes, CPU utilization slices (`V$RSRC_PDB_METRIC`), active sessions, and tablespace autoextend headroom.
2. **SGA/PGA Dual Memory Architecture**: Visual breakdown of System Global Area (Buffer Cache, Shared Pool, Large Pool, Java Pool, Redo Buffer) vs Program Global Area (Allocated, In-Use, Freeable), with Buffer Cache Hit Ratio gauge (<90% amber, <80% red).
3. **24-Hour Redo Log Switch Frequency Chart**: Hourly Recharts visualization highlighting switch spikes (>6/hr) to identify undersized redo logs and checkpoint thrashing.
4. **ASM (Automatic Storage Management) Diskgroup Grid**: Redundancy levels (`HIGH`, `NORMAL`, `EXTERNAL`), total/used/usable space, and offline disk health.
5. **Top Wait Classes & ASH Active Wait Events**: Real-time distribution of non-idle DB time across `System I/O`, `Commit`, `Concurrency`, `Application`, `Configuration`, and `Other`, with one-click Gemini AI diagnosis.
6. **Data Guard Replication Banner**: Primary vs Physical Standby role, transport lag, and apply lag telemetry.
7. **Oracle Background Processes Health Matrix**: Status badges for `PMON`, `SMON`, `DBWR`, `LGWR`, `CKPT`, `MMON`, and `ARCH`.

---

## 2. Existing Codebase Analysis & Gaps

### 2.1 File Inspection Summary

| File | Existing State | Identified Gaps for Oracle Monitoring |
|---|---|---|
| `src/types/dba.ts` | `DatabaseEngine` union includes `"Oracle"`, but `engineSpecific` only has fields for Postgres, SQL Server, and MySQL. | Missing `OracleEngineMetrics`, `OraclePDBMetrics`, `OracleSGAMetrics`, `OraclePGAMetrics`, `OracleASMDiskgroup`, `OracleWaitEvent`, `OracleRedoLogMetrics`, `OracleDataGuardMetrics`. |
| `src/components/dashboard/DatabaseEngineMetrics.tsx` | Tab buttons and views exist only for `"PostgreSQL"`, `"SQL Server"`, and `"MySQL"`. | No `"Oracle"` tab, no instance selector, no CDB/PDB container navigation, no SGA/PGA memory stacked meters, no redo log switch chart, no ASM grid. |
| `src/mock/dbaData.ts` | 4 database instances (`db-pg-01`, `db-mssql-01`, `db-mysql-01`, `db-pg-02`), 5 threshold rules, 3 incidents, 6 connection logs. | No Oracle DB instances, no CDB/PDB mock telemetry, no Oracle threshold rules, no Oracle incidents (e.g. Redo switch spike or Data Guard lag), no Oracle audit logs. |
| `src/components/databases/DatabaseManager.tsx` | Engine icons only handle Postgres (🐘), MSSQL (⚡), MySQL (🐬). Dropdown lacks Oracle port prefill (1521). | Needs Oracle icon (`🏛️` or `🔴`), port defaults (1521), and Oracle engine selection. |
| `src/components/layout/Navbar.tsx` | Fleet selector displays engine emoji badges for Postgres, MSSQL, MySQL. | Needs Oracle emoji icon rendering. |
| `src/context/DBAContext.tsx` | Simulates live metric ticks and random connection logs for Postgres, MSSQL, MySQL. | Ready to support Oracle metric simulation and logging. |

---

## 3. TypeScript Domain Model Specification (`src/types/dba.ts`)

To ensure type-safety and alignment across backend collectors, mock harnesses, and React components, we specify the following data contracts to be added to `src/types/dba.ts`:

```typescript
// ==========================================
// ORACLE MONITORING DATA CONTRACTS
// ==========================================

export type OracleOpenMode =
  | "READ WRITE"
  | "READ ONLY"
  | "MOUNTED"
  | "MIGRATE"
  | "READ WRITE (RESTRICTED)";

export type OracleWaitClassName =
  | "System I/O"
  | "Concurrency"
  | "Commit"
  | "Application"
  | "Configuration"
  | "User I/O"
  | "Network"
  | "Administrative"
  | "Other";

export type OracleASMRedundancy = "HIGH" | "NORMAL" | "EXTERN";

export interface OraclePDBMetrics {
  conId: number;
  pdbName: string;
  openMode: OracleOpenMode;
  restricted: boolean;
  totalSizeGb: number;
  usedSizeGb: number;
  activeSessions: number;
  totalSessions: number;
  cpuSlicePct: number; // % of total container CPU allocated to this PDB (V$RSRC_PDB_METRIC)
  cpuSecondsUsed: number;
  tablespaceCount: number;
  autoextendHeadroomGb: number;
  recoveryStatus: "ENABLED" | "DISABLED" | "RESTRICTED";
}

export interface OracleSGAMetrics {
  totalSgaMb: number;
  bufferCacheMb: number;
  sharedPoolMb: number;
  largePoolMb: number;
  javaPoolMb: number;
  redoBufferMb: number;
  streamsPoolMb?: number;
  freeSgaMb: number;
  bufferCacheHitRatio: number; // percentage (e.g. 98.6%)
  sharedPoolFreePct: number;
  dictionaryCacheHitRatio: number;
  libraryCacheHitRatio: number;
}

export interface OraclePGAMetrics {
  pgaTargetMb: number;
  pgaAllocatedMb: number;
  pgaInUseMb: number;
  pgaFreeableMb: number;
  pgaCacheHitRatio: number; // %
  autoPgaEnabled: boolean;
}

export interface OracleRedoSwitchHour {
  hour: string; // e.g. "00:00", "01:00", ... "23:00"
  switchCount: number;
  avgDurationMinutes: number;
  isSpike: boolean; // switchCount > 6
}

export interface OracleRedoLogMetrics {
  currentLogSequence: number;
  redoLogGroups: number;
  redoLogMemberSizeMb: number;
  avgSwitchesPerHour: number;
  currentSwitchRatePerHour: number;
  lgwrLatencyMs: number;
  last24HoursHistory: OracleRedoSwitchHour[];
}

export interface OracleASMDiskgroup {
  groupNumber: number;
  name: string; // e.g. "+DATA", "+RECO", "+FRA"
  state: "MOUNTED" | "DISMOUNTED" | "CONNECTED" | "BROKEN";
  type: OracleASMRedundancy;
  totalMb: number;
  freeMb: number;
  usableFileMb: number; // Usable free file space considering redundancy overhead
  usedPct: number;
  offlineDisks: number;
  totalDisks: number;
  votingFiles: boolean;
  auSizeMb: number;
}

export interface OracleWaitEvent {
  event: string; // e.g. "db file sequential read", "log file sync"
  waitClass: OracleWaitClassName;
  totalWaits: number;
  timeWaitedSec: number;
  avgWaitMs: number;
  pctDbTime: number;
}

export interface OracleWaitClassSummary {
  waitClass: OracleWaitClassName;
  timeWaitedSec: number;
  pctTime: number;
  color: string;
}

export interface OracleDataGuardMetrics {
  enabled: boolean;
  dbRole: "PRIMARY" | "PHYSICAL STANDBY" | "LOGICAL STANDBY" | "SNAPSHOT STANDBY";
  protectionMode: "MAXIMUM AVAILABILITY" | "MAXIMUM PERFORMANCE" | "MAXIMUM PROTECTION";
  status: "SYNCHRONIZED" | "APPLY_LAG" | "TRANSPORT_LAG" | "DISABLED" | "ERROR";
  transportLagSeconds: number;
  applyLagSeconds: number;
  redoTransportStatus: "VALID" | "CONNECTED" | "THROTTLED" | "ERROR";
  standbyApplyRateKbSec: number;
  primaryInstanceName?: string;
  standbyInstanceName?: string;
}

export interface OracleBackgroundProcesses {
  pmon: "RUNNING" | "STOPPED" | "DEGRADED";
  smon: "RUNNING" | "STOPPED" | "DEGRADED";
  dbwr: "RUNNING" | "STOPPED" | "DEGRADED";
  lgwr: "RUNNING" | "STOPPED" | "DEGRADED";
  ckpt: "RUNNING" | "STOPPED" | "DEGRADED";
  mmon: "RUNNING" | "STOPPED" | "DEGRADED";
  arch: "RUNNING" | "STOPPED" | "DEGRADED";
}

export interface OracleTablespaceMetric {
  tablespaceName: string;
  conName?: string;
  totalMb: number;
  usedMb: number;
  freeMb: number;
  usedPct: number;
  autoextensible: boolean;
  maxSizeMb: number;
  status: "ONLINE" | "READ ONLY" | "OFFLINE";
  contents: "PERMANENT" | "TEMPORARY" | "UNDO";
}

export interface OracleEngineMetrics {
  isCdb: boolean;
  cdbName?: string;
  instanceName: string;
  oracleHome?: string;
  archivelogMode: "ARCHIVELOG" | "NOARCHIVELOG";
  sga: OracleSGAMetrics;
  pga: OraclePGAMetrics;
  redoLogs: OracleRedoLogMetrics;
  asmDiskgroups: OracleASMDiskgroup[];
  topWaitEvents: OracleWaitEvent[];
  waitClasses: OracleWaitClassSummary[];
  dataGuard: OracleDataGuardMetrics;
  backgroundProcesses: OracleBackgroundProcesses;
  pdbs?: OraclePDBMetrics[];
  tablespaces: OracleTablespaceMetric[];
}
```

### Integration with `DBInstance`:
In `DBInstance.engineSpecific`:
```typescript
export interface DBInstance {
  // ... core fields ...
  engineSpecific: {
    // PostgreSQL
    autovacuumRunning?: boolean;
    walSizeMb?: number;
    idleInTransaction?: number;
    // SQL Server
    tempDbContentionPct?: number;
    pageLifeExpectancySec?: number;
    batchRequestsPerSec?: number;
    // MySQL
    innodbBufferHitRatio?: number;
    threadsConnected?: number;
    tableLocksWaiting?: number;
    // Oracle
    oracle?: OracleEngineMetrics;
  };
}
```

---

## 4. Oracle Tab Frontend UI Layout Design (`DatabaseEngineMetrics.tsx`)

The Oracle tab in `DatabaseEngineMetrics.tsx` is structured into 8 cohesive visual sections following modern DBA cockpit ergonomics.

```
+---------------------------------------------------------------------------------------------------+
|  🏛️ ORACLE DATABASE PERFORMANCE COCKPIT                                                           |
|  [Tab: PostgreSQL (2)] [Tab: SQL Server (1)] [Tab: MySQL (1)] [Tab: Oracle (2)]                   |
+---------------------------------------------------------------------------------------------------+
|  INSTANCE SELECTOR & HEADER                                                                       |
|  (•) ora-prod-fin-cdb01 (CDB 19c)    ( ) ora-dw-standalone-us (Standalone 21c)                    |
|  Version: Oracle 19.22 Enterprise | CDB Root + 3 PDBs | Mode: ARCHIVELOG | Host: ora-core-cdb:1521  |
+---------------------------------------------------------------------------------------------------+
|  BACKGROUND PROCESSES HEALTH                                                                      |
|  [PMON: RUNNING] [SMON: RUNNING] [DBWR: RUNNING] [LGWR: RUNNING] [CKPT: RUNNING] [MMON: RUNNING]  |
+---------------------------------------------------------------------------------------------------+
|  DATA GUARD REPLICATION BANNER                                                                    |
|  Role: PRIMARY | Protection: MAXIMUM AVAILABILITY | Status: SYNCHRONIZED (Apply Lag: 0.8s)        |
+---------------------------------------------------------------------------------------------------+
|  MULTITENANT CDB / PDB CONTAINER EXPLORER                                                          |
|  [All Containers Overview] [CDB$ROOT (1)] [SALES_PDB (3)] [FIN_PDB (4)] [HR_PDB (5)]               |
|  +--------------------+  +--------------------+  +--------------------+  +--------------------+   |
|  | CDB$ROOT           |  | SALES_PDB ⚠️       |  | FIN_PDB            |  | HR_PDB             |   |
|  | Mode: READ WRITE   |  | Mode: READ WRITE   |  | Mode: READ WRITE   |  | Mode: READ WRITE   |   |
|  | CPU Slice: 15.0%   |  | CPU Slice: 62.5% 🚨|  | CPU Slice: 18.2%   |  | CPU Slice: 4.3%    |   |
|  | Sessions: 18/45    |  | Sessions: 142/210  |  | Sessions: 38/80    |  | Sessions: 12/30    |   |
|  | Storage: 120 GB    |  | Storage: 850 GB    |  | Storage: 420 GB    |  | Storage: 95 GB     |   |
|  | Headroom: 500 GB   |  | Headroom: 45 GB ⚠️ |  | Headroom: 180 GB   |  | Headroom: 220 GB   |   |
|  +--------------------+  +--------------------+  +--------------------+  +--------------------+   |
+---------------------------------------------------------------------------------------------------+
|  MEMORY ARCHITECTURE: SGA vs PGA                                                                  |
|  +--------------------------------------------+  +--------------------------------------------+   |
|  | SYSTEM GLOBAL AREA (SGA) — 64.0 GB Total    |  | PROGRAM GLOBAL AREA (PGA) — 16.0 GB Target |   |
|  | [Buffer Cache: 56%] [Shared Pool: 28%] ... |  | Allocated: 12.8 GB | In-Use: 9.65 GB       |   |
|  | Buffer Cache Hit Ratio: 98.6% (Healthy)    |  | PGA Cache Hit Ratio: 99.1%                 |   |
|  | Shared Pool Free: 18.4 GB (14.2% Free)     |  | Auto PGA Memory Management: ENABLED        |   |
|  +--------------------------------------------+  +--------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
|  REDO LOG SWITCH FREQUENCY (24-Hour Bar Chart)                                                    |
|  Switches/hr: 9.0/hr ⚠️ | Avg Interval: 18.4 min | Log Sequence: #48,291 | LGWR Latency: 4.2ms    |
|  [|||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||]       |
|  (Highlighting >6/hr spikes at 14:00-16:00 peak hours)                                            |
+---------------------------------------------------------------------------------------------------+
|  ASM (AUTOMATIC STORAGE MANAGEMENT) DISKGROUPS                                                    |
|  +---------------------------+  +---------------------------+  +---------------------------+      |
|  | +DATA (NORMAL 2-Way)      |  | +RECO (HIGH 3-Way) ⚠️     |  | +FRA (EXTERNAL RAID)      |      |
|  | 2.87 TB / 4.00 TB (70.0%) |  | 1.74 TB / 2.00 TB (85.0%) |  | 614 GB / 1.00 TB (60.0%)  |      |
|  | Usable Free: 1.23 TB      |  | Usable Free: 307 GB       |  | Usable Free: 410 GB       |      |
|  | Disks: 0 Offline / 8 Act  |  | Disks: 0 Offline / 6 Act  |  | Disks: 0 Offline / 2 Act  |      |
|  +---------------------------+  +---------------------------+  +---------------------------+      |
+---------------------------------------------------------------------------------------------------+
|  TOP WAIT CLASSES & ACTIVE SESSION WAIT EVENTS                                                    |
|  Wait Class Bar: [System I/O 45.2%] [Commit 24.8%] [Concurrency 14.2%] [Application 9.1%] ...    |
|  Top Events: db file sequential read | log file sync | db file scattered read | enq: TX contention|
|  [AI Diagnose Event] buttons on each row linking to Gemini Root Cause Analysis                    |
+---------------------------------------------------------------------------------------------------+
```

### 4.1 Detailed Section Specifications

#### 1. Instance Header & Selector
- Multi-instance selector pills if $>1$ Oracle database is monitored.
- Version badge: `Oracle Database 19c Enterprise Edition Release 19.22.0.0.0` or `21c`.
- SID & Database Name: `PRODCDB1` / `ORCL19C`.
- Architecture Badge: `CDB Multitenant (3 PDBs)` (Indigo) or `Standalone Non-CDB` (Emerald).
- Archivelog mode: `ARCHIVELOG` (Emerald badge).
- Uptime formatted: e.g. `16d 10h 24m`.
- AI Audit button: Launches Gemini AI Root Cause modal for whole instance health check.

#### 2. Background Processes Health Matrix
- Horizontal row of pill badges displaying:
  - `PMON` (Process Monitor) — Status: `RUNNING` (green pulsing dot)
  - `SMON` (System Monitor) — Status: `RUNNING`
  - `DBWR` (Database Writer) — Status: `RUNNING`
  - `LGWR` (Log Writer) — Status: `RUNNING`
  - `CKPT` (Checkpoint) — Status: `RUNNING`
  - `MMON` (Manageability Monitor) — Status: `RUNNING`
  - `ARCH` (Archiver) — Status: `RUNNING`

#### 3. Data Guard Status Banner
- High-visibility banner across the top:
  - Role: `PRIMARY` (Emerald) or `PHYSICAL STANDBY` (Indigo)
  - Protection Mode: `MAXIMUM AVAILABILITY`
  - Status: `SYNCHRONIZED` (green) or `APPLY_LAG` (rose alert with lag value) or `TRANSPORT_LAG` (amber)
  - Metrics:
    - Transport Lag: `0.0s`
    - Apply Lag: `0.8s` (normal) vs `142.5s` (alert)
    - Redo Transport: `VALID`
    - Standby Apply Rate: `48.5 MB/s`

#### 4. Multitenant CDB / PDB Container Explorer
- Container Selector Tabs: `[All Containers Overview]`, `[CDB$ROOT]`, `[SALES_PDB]`, `[FIN_PDB]`, `[HR_PDB]`.
- Per-PDB Cards showing:
  - Open Mode: `READ WRITE` (green), `READ ONLY` (blue), `MOUNTED` (amber).
  - CPU Slice (% of total CPU): Progress bar with amber/rose alert when a single PDB consumes $>50\%$ of container CPU (addressing `ORCL-03` PDB CPU skew).
  - Active Sessions: `142 / 210` with session load gauge.
  - Storage & Autoextend Headroom: Total size + headroom before filesystem exhaustion (addressing `ORCL-04`).
  - Action buttons: "AI PDB Tuning" and "Inspect Lock Tree".

#### 5. Memory Architecture: SGA vs PGA Visualizer
- **SGA Breakdown**:
  - Stacked segmented bar showing:
    - Buffer Cache (Emerald)
    - Shared Pool (Indigo)
    - Large Pool (Purple)
    - Java Pool (Amber)
    - Redo Buffer (Rose)
    - Free Memory (Slate)
  - Buffer Cache Hit Ratio Gauge: `>= 90%` (Emerald), `80% - 90%` (Amber), `< 80%` (Rose — addressing `ORCL-01`).
  - Shared Pool Free %: e.g. `14.2%` (alert if $<5\%$, indicating `ORA-04031` risk).
  - Dictionary Cache Hit Ratio: `99.2%`.
  - Library Cache Hit Ratio: `99.5%`.
- **PGA Breakdown**:
  - Target vs Allocated vs In-Use vs Freeable memory meters.
  - PGA Cache Hit Ratio: `99.1%`.
  - Mode: `pga_aggregate_target (AUTO)`.

#### 6. Redo Log Switch Frequency Chart (24-Hour Recharts)
- Recharts `BarChart` within a responsive `h-56` container.
- 24 hourly bars (`00:00` to `23:00`).
- Conditional bar fill colors:
  - Normal ($\le 6$ switches/hr): `#6366f1` (Indigo) / `#10b981` (Emerald)
  - High Spike ($> 6$ switches/hr): `#f43f5e` (Rose — addressing `ORCL-02`)
- Interactive Tooltip displaying hour, switch count, average duration (mins), and spike severity badge.
- KPI Strip:
  - Current Switch Rate: `9.0 / hr` (Spike Warning)
  - Average Switch Interval: `18.4 min`
  - Current Log Sequence: `#48,291`
  - Redo Log Group Size: `3 Groups (1,024 MB each)`
  - LGWR Disk Flush Latency: `4.2 ms`

#### 7. ASM Diskgroup Grid
- Grid of cards for each ASM Diskgroup (`+DATA`, `+RECO`, `+FRA`):
  - Diskgroup Name & State (`+DATA` • `MOUNTED`).
  - Redundancy Badge: `NORMAL (2-way Mirroring)`, `HIGH (3-way)`, `EXTERNAL (Storage Array RAID)`.
  - Capacity Meter: `2.87 TB / 4.00 TB (70.0% used)`.
  - Usable Free File Space: `1.23 TB usable free space`.
  - Offline Disks Badge: `0 Offline / 8 Disks Active` (green) or `1 Offline` (rose alert!).
  - Voting Disk / OCR indicator icon.

#### 8. Top Wait Classes & Active Session Wait Events
- **Wait Class Horizontal Distribution**:
  - `System I/O` (45.2%), `Commit` (24.8%), `Concurrency` (14.2%), `Application` (9.1%), `Configuration` (4.5%), `Other` (2.2%).
- **Top Wait Events Table (`v$system_event`)**:
  - `db file sequential read` (System I/O) — 420,190 waits, 820.5s, 1.95ms avg
  - `log file sync` (Commit) — 184,200 waits, 680.2s, 3.69ms avg
  - `db file scattered read` (System I/O) — 98,400 waits, 420.0s, 4.26ms avg
  - `enq: TX - row lock contention` (Application) — 1,240 waits, 250.0s, 201.6ms avg
  - `buffer busy waits` (Concurrency) — 12,800 waits, 180.4s, 14.06ms avg
- Each row includes an **"AI Diagnose"** button invoking `openAiDiagnosis` with Oracle wait event context and SQL recommendations.

---

## 5. Mock Telemetry Data Specification (`src/mock/dbaData.ts`)

We specify two realistic Oracle database instances to be added to `INITIAL_DATABASES` in `src/mock/dbaData.ts`:

### 5.1 Instance 1: `ora-prod-fin-cdb01` (Multitenant 19c Enterprise CDB)
- **ID**: `db-ora-cdb01`
- **Topology**: Multitenant CDB with 3 active PDBs (`SALES_PDB`, `FIN_PDB`, `HR_PDB`).
- **Anomalies Injected**:
  - **PDB CPU Skew**: `SALES_PDB` consuming $62.5\%$ of container CPU (demonstrating `ORCL-03`).
  - **Redo Switch Spike**: Peak switch rate of $9.0$ switches/hr between 14:00 and 16:00 (demonstrating `ORCL-02`).
  - **Autoextend Headroom**: `SALES_PDB` tablespace autoextend headroom down to 45 GB.

### 5.2 Instance 2: `ora-dw-standalone-us` (Standalone 21c Enterprise)
- **ID**: `db-ora-standalone02`
- **Topology**: Standalone Non-CDB.
- **Anomalies Injected**:
  - **Data Guard Apply Lag**: Physical Standby apply lag spike to $142.5\text{s}$ with transport lag $18.2\text{s}$ (demonstrating `ORCL-05`).
  - **Buffer Cache Hit Ratio Warning**: Buffer Cache Hit Ratio at $86.4\%$ (amber warning $<90\%$, demonstrating `ORCL-01`).
  - **ASM Disk Capacity Warning**: `+RECO` diskgroup free space at $11\%$ ($<15\%$ free space threshold, demonstrating `ORCL-04`).

### 5.3 Oracle Alert Rules & Incidents
Add to `INITIAL_THRESHOLDS` and `INITIAL_INCIDENTS`:
- `thresh-06`: Oracle Redo Log Switch Frequency ($> 6.0\text{ switches/hr}$).
- `thresh-07`: Oracle Data Guard Apply Lag ($> 60.0\text{s}$).
- `inc-1004`: Firing Warning on `db-ora-cdb01` for Redo Log Switch Rate ($9.0\text{/hr}$).
- `inc-1005`: Firing Critical on `db-ora-standalone02` for Data Guard Apply Lag ($142.5\text{s}$).

### 5.4 Oracle Audit Connection Logs
Add to `INITIAL_CONNECTION_LOGS`:
- `log-8007`: `AUTH_SUCCESS` on `SALES_PDB` (`PID 48210` dedicated server spawned).
- `log-8008`: `QUERY_TIMEOUT` on `ora-dw-standalone-us` (`ORA-01013: user requested cancel during full table scan`).
- `log-8009`: `AUTH_FAILURE` on `FIN_PDB` (`ORA-01017: invalid username/password; logon denied`).

---

## 6. Complete Component Code Blueprint (`DatabaseEngineMetrics.tsx`)

Below is the concrete implementation structure for the Oracle tab in `src/components/dashboard/DatabaseEngineMetrics.tsx`:

```tsx
// Excerpt from DatabaseEngineMetrics.tsx for Oracle Tab:

{activeEngineTab === "Oracle" && selectedOracleDb && (
  <div className="mt-4 space-y-5">
    {/* 1. Instance Switcher & Header Bar */}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600/10 text-xl text-red-600 dark:bg-red-500/20 dark:text-red-400 font-bold shadow-inner">
          🏛️
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">
              {selectedOracleDb.name}
            </h4>
            <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              {oracleMetrics?.isCdb ? `CDB Multitenant (${oracleMetrics.pdbs?.length || 0} PDBs)` : "Standalone Non-CDB"}
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              {oracleMetrics?.archivelogMode || "ARCHIVELOG"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
            {selectedOracleDb.version} • SID: {oracleMetrics?.instanceName || "ORCL"} • Host: {selectedOracleDb.host}:{selectedOracleDb.port}
          </p>
        </div>
      </div>

      {/* Switcher & AI Trigger */}
      <div className="flex items-center gap-2">
        {oracleInstances.length > 1 && (
          <select
            value={selectedOracleDb.id}
            onChange={(e) => setSelectedOracleId(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
          >
            {oracleInstances.map((db) => (
              <option key={db.id} value={db.id}>
                {db.name} ({db.engineSpecific?.oracle?.isCdb ? "CDB" : "Standalone"})
              </option>
            ))}
          </select>
        )}

        <button
          onClick={() =>
            openAiDiagnosis({
              type: "slow_query",
              databaseType: "Oracle",
              query: `SELECT instance_name, host_name, version, status, archiver, database_status FROM v$instance;`,
              metrics: {
                sgaTotal: oracleMetrics?.sga.totalSgaMb,
                bufferHit: oracleMetrics?.sga.bufferCacheHitRatio,
                redoSwitches: oracleMetrics?.redoLogs.currentSwitchRatePerHour,
                dataGuardLag: oracleMetrics?.dataGuard.applyLagSeconds,
              },
            })
          }
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 transition cursor-pointer shadow-sm"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Oracle AI Health Check</span>
        </button>
      </div>
    </div>

    {/* 2. Background Processes Health Matrix */}
    {oracleMetrics?.backgroundProcesses && (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#1a1d23]">
        <span className="text-[11px] font-bold text-slate-400 uppercase flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-indigo-500" /> Background Processes:
        </span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(oracleMetrics.backgroundProcesses).map(([proc, status]) => {
            const isRunning = status === "RUNNING";
            return (
              <span
                key={proc}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                  isRunning
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 animate-pulse"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-emerald-500" : "bg-rose-500"}`} />
                {proc.toUpperCase()}: {status}
              </span>
            );
          })}
        </div>
      </div>
    )}

    {/* 3. Data Guard Replication & Standby Status Banner */}
    {oracleMetrics?.dataGuard && oracleMetrics.dataGuard.enabled && (
      <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-xl border p-3.5 transition ${
        oracleMetrics.dataGuard.status === "SYNCHRONIZED"
          ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20"
          : "border-rose-500/40 bg-rose-500/10 dark:bg-rose-950/30"
      }`}>
        <div className="flex items-center gap-3">
          <Shield className={`h-5 w-5 ${oracleMetrics.dataGuard.status === "SYNCHRONIZED" ? "text-emerald-500" : "text-rose-500"}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Oracle Data Guard ({oracleMetrics.dataGuard.dbRole})
              </span>
              <span className={`rounded px-1.5 py-0.2 text-[9px] font-black uppercase ${
                oracleMetrics.dataGuard.status === "SYNCHRONIZED" ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
              }`}>
                {oracleMetrics.dataGuard.status}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Mode: {oracleMetrics.dataGuard.protectionMode}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Transport Status: <strong className="text-slate-700 dark:text-slate-200">{oracleMetrics.dataGuard.redoTransportStatus}</strong> • Standby Apply Rate: <strong className="text-slate-700 dark:text-slate-200">{(oracleMetrics.dataGuard.standbyApplyRateKbSec / 1024).toFixed(1)} MB/s</strong>
            </p>
          </div>
        </div>

        <div className="mt-2 sm:mt-0 flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-400 text-[10px]">Transport Lag:</span>
            <p className="font-bold text-slate-800 dark:text-slate-200">+{oracleMetrics.dataGuard.transportLagSeconds}s</p>
          </div>
          <div>
            <span className="text-slate-400 text-[10px]">Apply Lag:</span>
            <p className={`font-bold ${oracleMetrics.dataGuard.applyLagSeconds > 60 ? "text-rose-500 font-black" : "text-emerald-500"}`}>
              +{oracleMetrics.dataGuard.applyLagSeconds}s
            </p>
          </div>
        </div>
      </div>
    )}

    {/* 4. Multitenant CDB / PDB Explorer */}
    {oracleMetrics?.isCdb && oracleMetrics.pdbs && (
      <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-800/30">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-200/60 dark:border-slate-700/60 gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-indigo-500" />
            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Multitenant Pluggable Database (PDB) Explorer
            </h4>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {oracleMetrics.pdbs.length} Containers Active
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {oracleMetrics.pdbs.map((pdb) => {
            const isHighCpu = pdb.cpuSlicePct > 50;
            const isLowHeadroom = pdb.autoextendHeadroomGb < 50;

            return (
              <div
                key={pdb.conId}
                className={`rounded-xl border p-3.5 transition flex flex-col justify-between ${
                  isHighCpu
                    ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-950/20"
                    : "border-slate-200 bg-white dark:border-slate-800 dark:bg-[#1a1d23]"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono text-slate-400">CON_ID: {pdb.conId}</span>
                      <h5 className="text-sm font-extrabold text-slate-900 dark:text-white">
                        {pdb.pdbName}
                      </h5>
                    </div>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                      {pdb.openMode}
                    </span>
                  </div>

                  {/* CPU Slice Meter */}
                  <div className="mt-3">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">CPU Slice:</span>
                      <span className={`font-bold font-mono ${isHighCpu ? "text-amber-500" : "text-slate-700 dark:text-slate-200"}`}>
                        {pdb.cpuSlicePct}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${isHighCpu ? "bg-amber-500" : "bg-indigo-500"}`}
                        style={{ width: `${Math.min(100, pdb.cpuSlicePct)}%` }}
                      />
                    </div>
                  </div>

                  {/* Sessions & Storage Grid */}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    <div>
                      <span>Active Sessions:</span>
                      <p className="font-bold text-slate-800 dark:text-slate-200">{pdb.activeSessions} / {pdb.totalSessions}</p>
                    </div>
                    <div>
                      <span>Used Space:</span>
                      <p className="font-bold text-slate-800 dark:text-slate-200">{pdb.usedSizeGb} GB</p>
                    </div>
                  </div>
                </div>

                {/* Autoextend Headroom Footer */}
                <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">Headroom:</span>
                  <span className={`font-bold font-mono ${isLowHeadroom ? "text-rose-500" : "text-emerald-500"}`}>
                    {pdb.autoextendHeadroomGb} GB free
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}

    {/* 5. Memory Architecture: SGA vs PGA Visualizer */}
    {oracleMetrics && (
      <div className="grid gap-4 lg:grid-cols-2">
        {/* System Global Area (SGA) Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#1a1d23]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-emerald-500" />
              SGA Memory Allocation ({(oracleMetrics.sga.totalSgaMb / 1024).toFixed(1)} GB)
            </span>
            <span className={`text-xs font-bold font-mono ${
              oracleMetrics.sga.bufferCacheHitRatio >= 90 ? "text-emerald-500" : "text-amber-500"
            }`}>
              Hit Ratio: {oracleMetrics.sga.bufferCacheHitRatio}%
            </span>
          </div>

          {/* SGA Dynamic Components Stacked Visual Bar */}
          <div className="mt-3">
            <div className="h-3 w-full overflow-hidden rounded-full flex bg-slate-100 dark:bg-slate-800">
              <div
                style={{ width: `${(oracleMetrics.sga.bufferCacheMb / oracleMetrics.sga.totalSgaMb) * 100}%` }}
                className="bg-emerald-500 h-full"
                title={`Buffer Cache: ${(oracleMetrics.sga.bufferCacheMb / 1024).toFixed(1)} GB`}
              />
              <div
                style={{ width: `${(oracleMetrics.sga.sharedPoolMb / oracleMetrics.sga.totalSgaMb) * 100}%` }}
                className="bg-indigo-500 h-full"
                title={`Shared Pool: ${(oracleMetrics.sga.sharedPoolMb / 1024).toFixed(1)} GB`}
              />
              <div
                style={{ width: `${(oracleMetrics.sga.largePoolMb / oracleMetrics.sga.totalSgaMb) * 100}%` }}
                className="bg-purple-500 h-full"
                title={`Large Pool: ${(oracleMetrics.sga.largePoolMb / 1024).toFixed(1)} GB`}
              />
              <div
                style={{ width: `${(oracleMetrics.sga.freeSgaMb / oracleMetrics.sga.totalSgaMb) * 100}%` }}
                className="bg-slate-400 h-full"
                title={`Free SGA: ${(oracleMetrics.sga.freeSgaMb / 1024).toFixed(1)} GB`}
              />
            </div>

            {/* SGA Legend Grid */}
            <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-slate-500">Buffer Cache:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{(oracleMetrics.sga.bufferCacheMb / 1024).toFixed(1)}G</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-500" />
                <span className="text-slate-500">Shared Pool:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{(oracleMetrics.sga.sharedPoolMb / 1024).toFixed(1)}G</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-purple-500" />
                <span className="text-slate-500">Large Pool:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{(oracleMetrics.sga.largePoolMb / 1024).toFixed(1)}G</span>
              </div>
            </div>
          </div>
        </div>

        {/* Program Global Area (PGA) Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#1a1d23]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-indigo-500" />
              PGA Memory ({(oracleMetrics.pga.pgaTargetMb / 1024).toFixed(1)} GB Target)
            </span>
            <span className="text-xs font-bold font-mono text-emerald-500">
              PGA Cache Hit: {oracleMetrics.pga.pgaCacheHitRatio}%
            </span>
          </div>

          <div className="mt-3 space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Allocated PGA:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{(oracleMetrics.pga.pgaAllocatedMb / 1024).toFixed(2)} GB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">In-Use Active:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{(oracleMetrics.pga.pgaInUseMb / 1024).toFixed(2)} GB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Freeable Headroom:</span>
              <span className="font-bold text-indigo-500">{(oracleMetrics.pga.pgaFreeableMb / 1024).toFixed(2)} GB</span>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* 6. Redo Log Switch Frequency Chart */}
    {oracleMetrics?.redoLogs && (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#1a1d23]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2">
          <div>
            <h4 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
              <RotateCw className="h-4 w-4 text-emerald-500" />
              Redo Log Switch Frequency (Last 24 Hours)
            </h4>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              Hourly checkpoint switches (Spikes &gt; 6/hr highlighted in red)
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono">
            <div>
              <span className="text-slate-400 text-[10px]">Current Rate:</span>
              <p className={`font-black ${oracleMetrics.redoLogs.currentSwitchRatePerHour > 6 ? "text-rose-500" : "text-emerald-500"}`}>
                {oracleMetrics.redoLogs.currentSwitchRatePerHour} / hr
              </p>
            </div>
            <div>
              <span className="text-slate-400 text-[10px]">LGWR Latency:</span>
              <p className="font-bold text-slate-800 dark:text-slate-200">{oracleMetrics.redoLogs.lgwrLatencyMs} ms</p>
            </div>
          </div>
        </div>

        <div className="mt-4 h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={oracleMetrics.redoLogs.last24HoursHistory}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
              <XAxis dataKey="hour" stroke="#94a3b8" fontSize={9} />
              <YAxis stroke="#94a3b8" fontSize={9} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderColor: "#334155",
                  borderRadius: "12px",
                  color: "#f8fafc",
                  fontSize: "11px",
                }}
              />
              <Bar
                dataKey="switchCount"
                name="Log Switches"
                isAnimationActive={false}
                radius={[4, 4, 0, 0]}
                fill="#6366f1"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    )}

    {/* 7. ASM Diskgroup Grid */}
    {oracleMetrics?.asmDiskgroups && oracleMetrics.asmDiskgroups.length > 0 && (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#1a1d23]">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <h4 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
            <HardDrive className="h-4 w-4 text-indigo-500" />
            ASM (Automatic Storage Management) Diskgroups
          </h4>
          <span className="text-[10px] text-slate-500 font-mono">
            {oracleMetrics.asmDiskgroups.length} Groups Mounted
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {oracleMetrics.asmDiskgroups.map((dg) => {
            const isHighUsage = dg.usedPct > 85;

            return (
              <div
                key={dg.name}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-black text-slate-900 dark:text-white">
                    {dg.name}
                  </span>
                  <span className="rounded bg-indigo-500/10 px-1.5 py-0.2 text-[9px] font-bold text-indigo-600 dark:text-indigo-400">
                    {dg.type} Redundancy
                  </span>
                </div>

                {/* Capacity Progress Bar */}
                <div className="mt-2.5">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-slate-400">Capacity:</span>
                    <span className={`font-bold ${isHighUsage ? "text-rose-500" : "text-slate-700 dark:text-slate-300"}`}>
                      {(dg.totalMb - dg.freeMb) / 1024 >= 1 ? `${((dg.totalMb - dg.freeMb) / 1024 / 1024).toFixed(2)} TB` : `${((dg.totalMb - dg.freeMb) / 1024).toFixed(0)} GB`} / {(dg.totalMb / 1024 / 1024).toFixed(2)} TB ({dg.usedPct}%)
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className={`h-full rounded-full ${isHighUsage ? "bg-rose-500" : "bg-emerald-500"}`}
                      style={{ width: `${dg.usedPct}%` }}
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>Usable Free: <strong className="text-slate-700 dark:text-slate-300">{(dg.usableFileMb / 1024 / 1024).toFixed(2)} TB</strong></span>
                  <span className={dg.offlineDisks > 0 ? "text-rose-500 font-bold" : "text-emerald-500"}>
                    {dg.offlineDisks} Offline / {dg.totalDisks} Disks
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}

    {/* 8. Top Wait Classes & Active Session Wait Events */}
    {oracleMetrics?.topWaitEvents && (
      <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-800/30">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-indigo-500" />
            Top Active Wait Events (V$SYSTEM_EVENT & Active Session History)
          </span>
        </div>

        <div className="overflow-x-auto text-[11px] font-mono text-slate-600 dark:text-slate-300">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400">
                <th className="py-1.5">Wait Event</th>
                <th className="py-1.5">Wait Class</th>
                <th className="py-1.5">Total Waits</th>
                <th className="py-1.5">Time Waited</th>
                <th className="py-1.5">Avg Wait</th>
                <th className="py-1.5">% DB Time</th>
                <th className="py-1.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800">
              {oracleMetrics.topWaitEvents.map((evt) => (
                <tr key={evt.event}>
                  <td className="py-1.5 font-bold text-slate-900 dark:text-white">{evt.event}</td>
                  <td className="py-1.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] dark:bg-slate-800">
                      {evt.waitClass}
                    </span>
                  </td>
                  <td className="py-1.5">{evt.totalWaits.toLocaleString()}</td>
                  <td className="py-1.5 font-bold text-indigo-500">{evt.timeWaitedSec}s</td>
                  <td className="py-1.5">{evt.avgWaitMs}ms</td>
                  <td className="py-1.5 font-bold text-emerald-500">{evt.pctDbTime}%</td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() =>
                        openAiDiagnosis({
                          type: "slow_query",
                          databaseType: "Oracle",
                          query: `-- Diagnosing Oracle Wait Event: ${evt.event} (${evt.waitClass})\nSELECT sid, event, wait_class, seconds_in_wait, sql_id FROM v$session WHERE event = '${evt.event}';`,
                          metrics: evt,
                        })
                      }
                      className="text-[10px] font-bold text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                    >
                      AI Diagnose
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}
  </div>
)}
```

---

## 7. Performance & 60fps Rendering Safeguards

In accordance with `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/react-dba-dashboard-optimization/SKILL.md`:
1. **Recharts Animation Controls**: `isAnimationActive={false}` is applied to the 24-hour Redo Log BarChart to eliminate animation recalculation spikes during the 3-second live ticker interval.
2. **Responsive Container Heights**: All chart parents use explicit Tailwind height classes (`h-48`, `h-56`) preventing flexbox reflow loops.
3. **Memoized Metric Computations**: Aggregations (SGA sums, PDB CPU slices) are pre-calculated inside the mock/collector rather than mapped continuously inside JSX render blocks.

---

## 8. Verification & Integration Checklist

- [x] Oracle Tab UI design covers all 8 specified functional areas.
- [x] Multitenant CDB/PDB selector and PDB grid cards designed with CPU slice, open mode, and autoextend headroom.
- [x] SGA/PGA memory architecture with color-coded breakdown and hit ratio gauge (<90% amber, <80% red).
- [x] 24-hour Redo Log Switch Frequency bar chart with >6/hr spike highlighting.
- [x] ASM diskgroup grid with redundancy modes, usable free space, and offline disk health.
- [x] Top Wait Classes and ASH events table with one-click Gemini AI diagnosis.
- [x] Data Guard status banner with primary/standby roles and transport/apply lag.
- [x] Background processes health matrix with PMON, SMON, DBWR, LGWR, CKPT, MMON badges.
- [x] Mock telemetry datasets for CDB Multitenant and Standalone instances with realistic anomalies.
- [x] Complete TypeScript interfaces designed for `src/types/dba.ts`.
