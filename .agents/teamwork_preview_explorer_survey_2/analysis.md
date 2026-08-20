# Technical Design & Requirements Specification
## R1: Oracle Database Monitoring (CDB/PDB Multitenant & Standalone)

---

## 1. Executive Summary & Architecture Overview

Oracle Database monitoring in DataPulse Sentinel must provide comprehensive, zero-downtime, non-blocking telemetry collection across both **Multitenant (CDB/PDB)** and **Non-CDB (Standalone)** Oracle architectures (versions 12c, 19c, 21c, and 23ai). 

The Oracle collector engine is engineered with:
1. **Multi-Tiered Polling Scheduler**: Fast L1 Heartbeat (5-10s) for session & connection health, L2 Telemetry (30-60s) for SGA/PGA, CPU, I/O & wait classes, and L3 Deep Capacity (5-15m) for tablespace autoextend headroom, ASM diskgroups, and historical redo log switch frequency.
2. **Pluggable Database (PDB) Resource Isolation**: Visibility into container-level resource slicing, PDB open modes, CPU throttling via Resource Manager (`V$RSRC_PDB_METRIC`), and session isolation.
3. **Low-Overhead V$ & CDB$ Dictionary Queries**: Designed with read-only performance views to ensure $<0.5\%$ CPU overhead on monitored instances.
4. **Dual Driver Architecture**: Native `node-oracledb` Thin Mode (pure TypeScript/JavaScript network driver without Oracle Instant Client binaries) with seamless fallback to a realistic `MockOracleDriver` for deterministic automated unit, integration, and load testing.
5. **Domain-Specific AI DBA Engine**: Rule-based heuristics combined with Gemini LLM reasoning for automated root-cause analysis of Oracle wait classes (`log file sync`, `db file sequential read`, `enq: TX - row lock contention`), SGA/PGA memory pressure, and Data Guard replication lag.

```
+----------------------------------------------------------------------------------------------------+
|                                    DataPulse Sentinel Backend                                      |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|   +--------------------------------------------------------------------------------------------+   |
|   |                              Oracle Telemetry Collector Engine                             |   |
|   |                                                                                            |   |
|   |  +------------------------+  +--------------------------+  +----------------------------+  |   |
|   |  |   L1 Heartbeat (5s)    |  |    L2 Telemetry (30s)    |  |   L3 Deep Diagnostics(5m)  |  |   |
|   |  | - Status & Ping        |  | - SGA/PGA Utilization    |  | - Tablespace Headroom      |  |   |
|   |  | - Active Sessions/PDB  |  | - Top Wait Classes       |  | - ASM Diskgroup Headroom   |  |   |
|   |  | - Blocking Locks       |  | - Redo Switch Rate       |  | - Background Proc Status   |  |   |
|   |  | - Data Guard Lag       |  | - Per-PDB CPU Slice      |  | - AWR/ASH Top SQL          |  |   |
|   |  +------------------------+  +--------------------------+  +----------------------------+  |   |
|   +--------------------------------------------------------------------------------------------+   |
|                                                |                                                   |
|                                                v                                                   |
|                        +-----------------------------------------------+                           |
|                        |          Oracle Driver Abstraction            |                           |
|                        +-----------------------------------------------+                           |
|                                  /                           \                                     |
|                                 v                             v                                    |
|              +----------------------------------+   +----------------------------------+           |
|              |      node-oracledb Thin Mode     |   |        MockOracleDriver          |           |
|              | (Pure JS TNS Wire Protocol)      |   | (Deterministic Simulation & Tests|           |
|              +----------------------------------+   +----------------------------------+           |
|                                |                                                                   |
+--------------------------------|-------------------------------------------------------------------+
                                 v
        +--------------------------------------------------+
        |                 Oracle Database                  |
        |  +--------------------------------------------+  |
        |  | CDB$ROOT (SGA/PGA, Redo Logs, ASM, V$)     |  |
        |  +---------------------+----------------------+  |
        |                        |                         |
        |         +--------------+--------------+          |
        |         |                             |          |
        |         v                             v          |
        |  +---------------+             +---------------+ |
        |  | PDB_FINANCE   |             | PDB_SALES     | |
        |  | (Sessions,    |             | (Sessions,    | |
        |  |  CPU Metric,  |             |  CPU Metric,  | |
        |  |  Tablespaces) |             |  Tablespaces) | |
        |  +---------------+             +---------------+ |
        +--------------------------------------------------+
```

---

## 2. Telemetry Queries & Oracle Data Dictionary Specifications

All queries are structured to work on Oracle 12cR1 through 23ai. In Multitenant environments (`cdb = 'YES'`), CDB views (`CDB_DATA_FILES`, `CDB_FREE_SPACE`, `V$PDBS`, `V$RSRC_PDB_METRIC`) provide global cluster visibility. In Non-CDB Standalone environments, the driver gracefully executes standalone equivalents (`DBA_DATA_FILES`, `DBA_FREE_SPACE`).

### 2.1 Database & Instance Topology Detection
**Purpose**: Determine whether the database is CDB or Non-CDB, instance role (Primary vs Physical Standby), version, and startup time.

```sql
SELECT 
  d.name AS db_name,
  d.db_unique_name,
  d.database_role,
  d.cdb,
  d.open_mode,
  i.instance_name,
  i.host_name,
  i.version,
  i.startup_time,
  ROUND((SYSDATE - i.startup_time) * 86400) AS uptime_seconds,
  i.status AS instance_status
FROM v$database d, v$instance i;
```

---

### 2.2 Memory Telemetry: SGA & PGA Allocation

#### 2.2.1 SGA Dynamic Sizing & Component Breakdown (`V$SGAINFO`, `V$SGA_DYNAMIC_COMPONENTS`)
```sql
SELECT 
  name AS component_name,
  bytes,
  resizeable
FROM v$sgainfo;
```
*Aggregation Logic*:
- `sga_total_bytes`: Value where `name = 'Maximum SGA Size'` or sum of active components.
- `sga_buffer_cache_bytes`: Value where `name = 'Buffer Cache Size'`.
- `sga_shared_pool_bytes`: Value where `name = 'Shared Pool Size'`.
- `sga_large_pool_bytes`: Value where `name = 'Large Pool Size'`.
- `sga_free_bytes`: Value where `name = 'Free SGA Memory Available'`.

#### 2.2.2 Buffer Cache Hit Ratio (`V$SYSSTAT`)
```sql
SELECT 
  ROUND((1 - (phy.value / NULLIF(cur.value + con.value, 0))) * 100, 2) AS buffer_cache_hit_ratio
FROM 
  (SELECT value FROM v$sysstat WHERE name = 'physical reads') phy,
  (SELECT value FROM v$sysstat WHERE name = 'db block gets') cur,
  (SELECT value FROM v$sysstat WHERE name = 'consistent gets') con;
```

#### 2.2.3 PGA Memory Consumption & Cache Hit Percentage (`V$PGASTAT`)
```sql
SELECT 
  name,
  value,
  unit
FROM v$pgastat
WHERE name IN (
  'aggregate PGA target parameter',
  'total PGA allocated',
  'total PGA inuse',
  'total freeable PGA memory',
  'maximum PGA allocated',
  'PGA memory freed back to OS',
  'cache hit percentage',
  'over allocation count'
);
```

---

### 2.3 Redo Log Switch Frequency & Checkpoint Pressure (`V$LOG_HISTORY`)
**Purpose**: Monitor redo generation rates. Normal production threshold is 2-5 switches per hour. $>10$ switches/hour indicates undersized redo logs, triggering severe DBWR checkpoint spikes and `log file sync` waits.

```sql
SELECT 
  COUNT(CASE WHEN first_time >= SYSDATE - (1/24) THEN 1 END) AS switches_last_hour,
  COUNT(CASE WHEN first_time >= SYSDATE - (6/24) THEN 1 END) AS switches_last_6h,
  COUNT(CASE WHEN first_time >= SYSDATE - 1 THEN 1 END) AS switches_last_24h,
  ROUND(COUNT(CASE WHEN first_time >= SYSDATE - 1 THEN 1 END) / 24, 2) AS avg_switches_per_hour,
  MAX(first_time) AS last_switch_time
FROM v$log_history
WHERE first_time >= SYSDATE - 1;
```

Hourly distribution bucket query for sparkline rendering:
```sql
SELECT 
  TO_CHAR(first_time, 'YYYY-MM-DD HH24:00') AS time_bucket,
  COUNT(*) AS switch_count
FROM v$log_history
WHERE first_time >= SYSDATE - 1
GROUP BY TO_CHAR(first_time, 'YYYY-MM-DD HH24:00')
ORDER BY time_bucket ASC;
```

---

### 2.4 ASM Diskgroup Utilization & Headroom (`V$ASM_DISKGROUP`)
**Purpose**: Track raw vs usable diskgroup storage with ASM redundancy awareness (Normal = 2-way mirror, High = 3-way mirror).

```sql
SELECT 
  group_number,
  name AS diskgroup_name,
  sector_size,
  block_size,
  allocation_unit_size,
  state,
  type AS redundancy_type,
  total_mb,
  free_mb,
  usable_file_mb,
  offline_disks,
  ROUND(((total_mb - free_mb) / NULLIF(total_mb, 0)) * 100, 2) AS used_pct,
  ROUND((free_mb / NULLIF(total_mb, 0)) * 100, 2) AS free_pct
FROM v$asm_diskgroup
ORDER BY diskgroup_name;
```
*Note*: If instance does not utilize ASM (returns `ORA-00942` or empty set), collector sets `asmEnabled: false` and skips ASM alerting without error.

---

### 2.5 Critical Background Process Health (`V$BGPROCESS`, `V$PROCESS`)
**Purpose**: Verify existence, OS PID, memory usage, and error state for critical Oracle background engines:
- `PMON` (Process Monitor): Cleans up failed user processes.
- `SMON` (System Monitor): Instance recovery and temporary segment cleanup.
- `DBWR` / `DBW0`-`DBW9` (Database Writer): Flushes dirty buffers from SGA to disk.
- `LGWR` / `LG00`-`LG09` (Log Writer): Flushes redo log buffer to active redo log files.
- `CKPT` (Checkpoint): Signals DBWR and updates datafile headers.
- `MMON` / `MMNL` (Manageability Monitor): Gathers AWR statistics and active session snapshots.
- `VKTM` (Virtual Keeper of Time): High-resolution timer.

```sql
SELECT 
  b.name AS process_name,
  b.description,
  b.error,
  p.spid AS os_pid,
  ROUND(p.pga_used_mem / (1024*1024), 2) AS pga_used_mb,
  ROUND(p.pga_alloc_mem / (1024*1024), 2) AS pga_alloc_mb,
  ROUND(p.pga_max_mem / (1024*1024), 2) AS pga_max_mb,
  CASE WHEN p.spid IS NOT NULL THEN 'RUNNING' ELSE 'STOPPED' END AS status
FROM v$bgprocess b
LEFT JOIN v$process p ON b.paddr = p.addr
WHERE b.name IN ('PMON', 'SMON', 'DBWR', 'LGWR', 'CKPT', 'MMON', 'MMNL', 'RECO', 'VKTM', 'DBW0', 'LG00')
   OR (b.paddr != '00' AND b.name LIKE 'ARC%')
ORDER BY b.name;
```

---

### 2.6 Multitenant Container Telemetry (CDB & PDB Metrics)

#### 2.6.1 Pluggable Database Status & Size (`V$PDBS`)
```sql
SELECT 
  con_id,
  dbid,
  name AS pdb_name,
  open_mode,
  restricted,
  open_time,
  ROUND(total_size / (1024*1024*1024), 2) AS total_size_gb,
  recovery_status
FROM v$pdbs
ORDER BY con_id;
```

#### 2.6.2 Per-PDB CPU Slice & Resource Utilization (`V$RSRC_PDB_METRIC`)
```sql
SELECT 
  m.con_id,
  p.name AS pdb_name,
  m.cpu_utilization_limit,
  m.avg_cpu_utilization AS cpu_pct_utilized,
  ROUND(m.cpu_consumed_time / 1000, 2) AS cpu_consumed_sec,
  ROUND(m.cpu_waiting_time / 1000, 2) AS cpu_waiting_sec,
  m.running_sessions_limit,
  m.avg_running_sessions,
  m.avg_waiting_sessions,
  m.iops,
  m.iombps
FROM v$rsrc_pdb_metric m
JOIN v$pdbs p ON m.con_id = p.con_id
ORDER BY m.avg_cpu_utilization DESC;
```

#### 2.6.3 Active & Blocked Sessions Breakdown per PDB (`V$SESSION`)
```sql
SELECT 
  s.con_id,
  COALESCE(p.name, 'CDB$ROOT') AS pdb_name,
  COUNT(s.sid) AS total_sessions,
  COUNT(CASE WHEN s.status = 'ACTIVE' AND s.type != 'BACKGROUND' THEN 1 END) AS active_user_sessions,
  COUNT(CASE WHEN s.status = 'INACTIVE' THEN 1 END) AS inactive_sessions,
  COUNT(CASE WHEN s.blocking_session IS NOT NULL THEN 1 END) AS blocked_sessions
FROM v$session s
LEFT JOIN v$pdbs p ON s.con_id = p.con_id
GROUP BY s.con_id, p.name
ORDER BY active_user_sessions DESC;
```

#### 2.6.4 Tablespace Utilization & Autoextend Headroom (`CDB_DATA_FILES` / `CDB_FREE_SPACE`)
**Purpose**: Monitor current data file size vs max autoextend limit (`MAXBYTES`) to detect true storage exhaustion risk before files fill disk.

```sql
SELECT 
  df.con_id,
  COALESCE(p.name, 'CDB$ROOT') AS pdb_name,
  df.tablespace_name,
  ROUND(df.total_allocated_mb, 2) AS allocated_mb,
  ROUND(df.total_allocated_mb - NVL(fs.free_space_mb, 0), 2) AS used_mb,
  ROUND(NVL(fs.free_space_mb, 0), 2) AS free_mb,
  ROUND(df.max_extend_mb, 2) AS max_size_mb,
  ROUND(df.max_extend_mb - (df.total_allocated_mb - NVL(fs.free_space_mb, 0)), 2) AS total_headroom_mb,
  ROUND(((df.total_allocated_mb - NVL(fs.free_space_mb, 0)) / NULLIF(df.max_extend_mb, 0)) * 100, 2) AS used_pct_of_max,
  df.is_autoextensible
FROM (
  SELECT 
    con_id,
    tablespace_name,
    SUM(bytes) / (1024*1024) AS total_allocated_mb,
    SUM(CASE WHEN autoextensible = 'YES' THEN maxbytes ELSE bytes END) / (1024*1024) AS max_extend_mb,
    MAX(autoextensible) AS is_autoextensible
  FROM cdb_data_files
  GROUP BY con_id, tablespace_name
) df
LEFT JOIN (
  SELECT 
    con_id,
    tablespace_name,
    SUM(bytes) / (1024*1024) AS free_space_mb
  FROM cdb_free_space
  GROUP BY con_id, tablespace_name
) fs ON df.con_id = fs.con_id AND df.tablespace_name = fs.tablespace_name
LEFT JOIN v$pdbs p ON df.con_id = p.con_id
ORDER BY used_pct_of_max DESC;
```

---

### 2.7 Wait Events, Locks & Active Session History

#### 2.7.1 Top Wait Classes Aggregation (`V$SYSTEM_EVENT`)
```sql
SELECT 
  wait_class,
  SUM(total_waits) AS total_waits,
  ROUND(SUM(time_waited_micro) / 1000000, 2) AS total_time_waited_sec,
  ROUND(AVG(average_wait) / 100, 2) AS avg_wait_ms
FROM v$system_event
WHERE wait_class NOT IN ('Idle')
GROUP BY wait_class
ORDER BY total_time_waited_sec DESC;
```

#### 2.7.2 Top Wait Events in Real-Time (`V$SYSTEM_EVENT`)
```sql
SELECT 
  event,
  wait_class,
  total_waits,
  ROUND(time_waited_micro / 1000000, 2) AS time_waited_sec,
  ROUND(average_wait / 100, 2) AS avg_wait_ms
FROM v$system_event
WHERE wait_class NOT IN ('Idle')
ORDER BY time_waited_micro DESC
FETCH FIRST 10 ROWS ONLY;
```

#### 2.7.3 Real-Time Blocking Session Lock Tree (`V$SESSION`)
```sql
SELECT 
  s.blocking_session AS blocker_sid,
  bs.serial# AS blocker_serial,
  bs.username AS blocker_username,
  bs.program AS blocker_program,
  bs.sql_id AS blocker_sql_id,
  s.sid AS blocked_sid,
  s.serial# AS blocked_serial,
  s.username AS blocked_username,
  s.program AS blocked_program,
  s.sql_id AS blocked_sql_id,
  s.seconds_in_wait,
  s.event AS wait_event,
  s.con_id,
  COALESCE(p.name, 'CDB$ROOT') AS pdb_name
FROM v$session s
JOIN v$session bs ON s.blocking_session = bs.sid
LEFT JOIN v$pdbs p ON s.con_id = p.con_id
WHERE s.blocking_session IS NOT NULL
ORDER BY s.seconds_in_wait DESC;
```

---

### 2.8 Data Guard Replication & Standby Telemetry

#### 2.8.1 Data Guard Lag Metrics (`V$DATAGUARD_STATS`)
```sql
SELECT 
  name AS stat_name,
  value AS lag_formatted,
  unit,
  time_computed,
  datum_time
FROM v$dataguard_stats
WHERE name IN ('transport lag', 'apply lag', 'apply finish time', 'estimated startup time');
```

#### 2.8.2 Archive Destination & MRP Status (`V$ARCHIVE_DEST_STATUS`)
```sql
SELECT 
  dest_id,
  dest_name,
  status,
  target,
  database_mode,
  recovery_mode,
  protection_mode,
  applied_seq#,
  gap_status,
  error
FROM v$archive_dest_status
WHERE status != 'INACTIVE';
```

---

## 3. TypeScript Type Definitions & Schemas

### 3.1 Extended Database Models (`src/types/dba.ts`)

```typescript
export interface OracleTablespaceMetric {
  conId: number;
  pdbName: string;
  tablespaceName: string;
  allocatedMb: number;
  usedMb: number;
  freeMb: number;
  maxSizeMb: number;
  totalHeadroomMb: number;
  usedPctOfMax: number;
  isAutoextensible: boolean;
}

export interface OraclePdbMetric {
  conId: number;
  dbid: number;
  name: string;
  openMode: "READ WRITE" | "READ ONLY" | "MOUNTED" | "MIGRATE";
  restricted: boolean;
  openTime?: string;
  totalSizeGb: number;
  activeSessions: number;
  inactiveSessions: number;
  blockedSessions: number;
  cpuUtilizationPct: number;
  cpuConsumedSec: number;
  cpuWaitingSec: number;
  avgRunningSessions: number;
  avgWaitingSessions: number;
  iops: number;
  iombps: number;
}

export interface OracleAsmDiskgroupMetric {
  groupNumber: number;
  name: string;
  state: "MOUNTED" | "DISMOUNTED" | "CONNECTED" | "UNKNOWN";
  redundancyType: "EXTERN" | "NORMAL" | "HIGH" | "FLEX";
  totalMb: number;
  freeMb: number;
  usableFileMb: number;
  offlineDisks: number;
  usedPct: number;
  freePct: number;
}

export interface OracleBackgroundProcessMetric {
  name: string;
  description: string;
  osPid: string | null;
  status: "RUNNING" | "STOPPED" | "ERROR";
  pgaUsedMb: number;
  pgaAllocMb: number;
  error?: string;
}

export interface OracleWaitClassMetric {
  waitClass: "System I/O" | "Concurrency" | "Commit" | "Application" | "Configuration" | "Network" | "User I/O" | "Administrative" | "Other";
  totalWaits: number;
  timeWaitedSec: number;
  avgWaitMs: number;
  pctOfTotalTime: number;
}

export interface OracleWaitEventMetric {
  event: string;
  waitClass: string;
  totalWaits: number;
  timeWaitedSec: number;
  avgWaitMs: number;
}

export interface OracleBlockingLock {
  blockerSid: number;
  blockerSerial: number;
  blockerUsername: string;
  blockerProgram: string;
  blockerSqlId?: string;
  blockedSid: number;
  blockedSerial: number;
  blockedUsername: string;
  blockedProgram: string;
  blockedSqlId?: string;
  secondsInWait: number;
  waitEvent: string;
  conId: number;
  pdbName: string;
}

export interface OracleDataGuardMetric {
  configured: boolean;
  role: "PRIMARY" | "PHYSICAL STANDBY" | "LOGICAL STANDBY" | "SNAPSHOT STANDBY";
  protectionMode: "MAXIMUM AVAILABILITY" | "MAXIMUM PERFORMANCE" | "MAXIMUM PROTECTION";
  transportLagSeconds: number;
  applyLagSeconds: number;
  mrpStatus: string;
  gapStatus: "NONE" | "LOCATED" | "UNRESOLVED";
  destinations: {
    destId: number;
    target: string;
    status: string;
    appliedSeq: number;
    error?: string;
  }[];
}

export interface OracleEngineDetails {
  isCdb: boolean;
  cdbName: string;
  openMode: string;
  databaseRole: "PRIMARY" | "PHYSICAL STANDBY" | "LOGICAL STANDBY" | "SNAPSHOT STANDBY";
  
  // SGA & PGA Memory
  sga: {
    totalMb: number;
    bufferCacheMb: number;
    sharedPoolMb: number;
    largePoolMb: number;
    freeSgaMb: number;
    bufferCacheHitRatio: number;
  };
  pga: {
    targetMb: number;
    allocatedMb: number;
    inUseMb: number;
    freeableMb: number;
    maxAllocatedMb: number;
    cacheHitRatio: number;
    overAllocationCount: number;
  };

  // Redo Switch Frequency
  redo: {
    switchesLastHour: number;
    switchesLast6h: number;
    switchesLast24h: number;
    avgSwitchesPerHour: number;
    lastSwitchTime: string;
    hourlyHistory: { timeBucket: string; switchCount: number }[];
  };

  // ASM Diskgroups
  asmEnabled: boolean;
  asmDiskgroups: OracleAsmDiskgroupMetric[];

  // Background Processes
  backgroundProcesses: OracleBackgroundProcessMetric[];

  // Multitenant PDBs (empty array if non-CDB)
  pdbs: OraclePdbMetric[];

  // Tablespaces
  tablespaces: OracleTablespaceMetric[];

  // Wait Events & Diagnostics
  topWaitClasses: OracleWaitClassMetric[];
  topWaitEvents: OracleWaitEventMetric[];
  blockingLocks: OracleBlockingLock[];

  // Data Guard
  dataGuard: OracleDataGuardMetric;
}
```

---

## 4. Multi-Tiered Polling Scheduler Cadence

To balance real-time responsiveness with database overhead, the Oracle collector partitions queries into three distinct cadence tiers:

| Tier | Interval | Executed Queries | Failure & Alert Behavior |
| :--- | :--- | :--- | :--- |
| **Tier 1: Heartbeat** | 5 – 10 sec | - Topology & Ping (`V$INSTANCE`, `V$DATABASE`)<br>- Active/Blocked Sessions (`V$SESSION`)<br>- Blocking Lock Tree (`V$SESSION` join)<br>- Data Guard Lag (`V$DATAGUARD_STATS`) | If $>2$ consecutive timeouts: trigger `CRITICAL_DOWN` alert & engage circuit breaker backoff. |
| **Tier 2: Telemetry** | 30 – 60 sec | - SGA/PGA Memory (`V$SGAINFO`, `V$PGASTAT`)<br>- Buffer Cache Hit Ratio (`V$SYSSTAT`)<br>- Per-PDB CPU/IO Slices (`V$RSRC_PDB_METRIC`)<br>- Top Wait Classes & Events (`V$SYSTEM_EVENT`)<br>- Redo Switches in last hour (`V$LOG_HISTORY`) | Append to in-memory 60-sample sliding window buffer. Stream delta to UI via SSE/WebSocket. |
| **Tier 3: Deep Capacity** | 5 – 15 min | - Tablespace Headroom (`CDB_DATA_FILES`, `CDB_FREE_SPACE`)<br>- ASM Diskgroup Usable Space (`V$ASM_DISKGROUP`)<br>- Background Processes (`V$BGPROCESS`, `V$PROCESS`)<br>- 24h Redo switch distribution history | Update capacity forecasts and check autoextend threshold exhaustion. |

---

## 5. Driver & Mock Architecture Specification

### 5.1 Connection Configuration & Thin Mode Interface

```typescript
import oracledb from "oracledb";

export interface OracleConnectionOptions {
  user: string;
  password?: string;
  connectString: string; // e.g. "oracle-prod.corp:1521/ORCLCDB" or EZConnect "(DESCRIPTION=...)"
  privilege?: number;     // e.g. oracledb.SYSDBA (for CDB root views)
  poolMin?: number;       // default: 1
  poolMax?: number;       // default: 5 (low connection footprint)
  poolIncrement?: number; // default: 1
  poolTimeout?: number;   // default: 60s
  connectTimeout?: number;// default: 5s
  isMock?: boolean;
}

export interface IOracleDriver {
  connect(options: OracleConnectionOptions): Promise<void>;
  query<T = any>(sql: string, binds?: Record<string, any> | any[]): Promise<T[]>;
  ping(): Promise<{ success: boolean; latencyMs: number }>;
  close(): Promise<void>;
  isHealthy(): boolean;
}
```

### 5.2 Native `node-oracledb` Thin Mode Implementation
`node-oracledb` 6.x supports pure JavaScript Thin Mode without client libraries:
- No Oracle Instant Client ZIPs or `LD_LIBRARY_PATH` required.
- Standard TCP communication with Oracle Net Listener.
- Safe `SYSDBA` privilege elevation for CDB dictionary introspection.

```typescript
export class ThinOracleDriver implements IOracleDriver {
  private pool: oracledb.Pool | null = null;
  private options: OracleConnectionOptions;

  constructor(options: OracleConnectionOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    // Enable pure thin mode
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.fetchAsString = [oracledb.CLOB];

    this.pool = await oracledb.createPool({
      user: this.options.user,
      password: this.options.password,
      connectString: this.options.connectString,
      privilege: this.options.privilege,
      poolMin: this.options.poolMin ?? 1,
      poolMax: this.options.poolMax ?? 5,
      poolIncrement: this.options.poolIncrement ?? 1,
      poolTimeout: this.options.poolTimeout ?? 60,
      connectTimeout: this.options.connectTimeout ?? 5000,
    });
  }

  async query<T = any>(sql: string, binds: Record<string, any> | any[] = {}): Promise<T[]> {
    if (!this.pool) throw new Error("Oracle connection pool not initialized");
    let connection: oracledb.Connection | null = null;
    try {
      connection = await this.pool.getConnection();
      const result = await connection.execute<T>(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        resultSet: false,
      });
      return (result.rows as T[]) || [];
    } finally {
      if (connection) {
        await connection.close();
      }
    }
  }

  async ping(): Promise<{ success: boolean; latencyMs: number }> {
    const start = performance.now();
    try {
      await this.query("SELECT 1 AS PING FROM DUAL");
      const latencyMs = Number((performance.now() - start).toFixed(2));
      return { success: true, latencyMs };
    } catch (err: any) {
      return { success: false, latencyMs: -1 };
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close(10);
      this.pool = null;
    }
  }

  isHealthy(): boolean {
    return this.pool !== null;
  }
}
```

### 5.3 Deterministic `MockOracleDriver` for Tests & Local Dev

```typescript
export class MockOracleDriver implements IOracleDriver {
  private connected: boolean = false;
  private latencyMs: number = 4.2;
  private scenario: "HEALTHY_CDB" | "STANDALONE_NON_CDB" | "PDB_STARVATION" | "HIGH_LOG_SWITCH" | "TABLESPACE_FULL" | "DATA_GUARD_LAG";

  constructor(scenario: "HEALTHY_CDB" | "STANDALONE_NON_CDB" | "PDB_STARVATION" | "HIGH_LOG_SWITCH" | "TABLESPACE_FULL" | "DATA_GUARD_LAG" = "HEALTHY_CDB") {
    this.scenario = scenario;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async query<T = any>(sql: string, binds: Record<string, any> | any[] = {}): Promise<T[]> {
    if (!this.connected) throw new Error("Mock Oracle driver not connected");
    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();

    // 1. Database & Instance Topology
    if (normalized.includes("FROM V$DATABASE") && normalized.includes("V$INSTANCE")) {
      return [
        {
          DB_NAME: "ORCLCDB",
          DB_UNIQUE_NAME: "ORCLCDB_PRX",
          DATABASE_ROLE: "PRIMARY",
          CDB: this.scenario === "STANDALONE_NON_CDB" ? "NO" : "YES",
          OPEN_MODE: "READ WRITE",
          INSTANCE_NAME: "orclcdb1",
          HOST_NAME: "ora-primary-01.corp.internal",
          VERSION: "19.22.0.0.0",
          STARTUP_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(),
          UPTIME_SECONDS: 1209600,
          INSTANCE_STATUS: "OPEN",
        },
      ] as any;
    }

    // 2. SGA Info
    if (normalized.includes("FROM V$SGAINFO")) {
      return [
        { COMPONENT_NAME: "Maximum SGA Size", BYTES: 34359738368, RESIZEABLE: "No" },     // 32 GB
        { COMPONENT_NAME: "Buffer Cache Size", BYTES: 21474836480, RESIZEABLE: "Yes" },    // 20 GB
        { COMPONENT_NAME: "Shared Pool Size", BYTES: 8589934592, RESIZEABLE: "Yes" },      // 8 GB
        { COMPONENT_NAME: "Large Pool Size", BYTES: 1073741824, RESIZEABLE: "Yes" },       // 1 GB
        { COMPONENT_NAME: "Free SGA Memory Available", BYTES: 2147483648, RESIZEABLE: "No" }, // 2 GB
      ] as any;
    }

    // 3. PGA Stat
    if (normalized.includes("FROM V$PGASTAT")) {
      return [
        { NAME: "aggregate PGA target parameter", VALUE: 17179869184, UNIT: "bytes" }, // 16 GB
        { NAME: "total PGA allocated", VALUE: 12884901888, UNIT: "bytes" },           // 12 GB
        { NAME: "total PGA inuse", VALUE: 9663676416, UNIT: "bytes" },               // 9 GB
        { NAME: "total freeable PGA memory", VALUE: 2147483648, UNIT: "bytes" },
        { NAME: "maximum PGA allocated", VALUE: 15032385536, UNIT: "bytes" },
        { NAME: "cache hit percentage", VALUE: 98.4, UNIT: "percent" },
        { NAME: "over allocation count", VALUE: 0, UNIT: "count" },
      ] as any;
    }

    // 4. Redo Log History
    if (normalized.includes("FROM V$LOG_HISTORY")) {
      const switchCount = this.scenario === "HIGH_LOG_SWITCH" ? 28 : 4;
      return [
        {
          SWITCHES_LAST_HOUR: switchCount,
          SWITCHES_LAST_6H: switchCount * 5,
          SWITCHES_LAST_24H: switchCount * 20,
          AVG_SWITCHES_PER_HOUR: switchCount,
          LAST_SWITCH_TIME: new Date().toISOString(),
        },
      ] as any;
    }

    // 5. ASM Diskgroups
    if (normalized.includes("FROM V$ASM_DISKGROUP")) {
      return [
        {
          GROUP_NUMBER: 1,
          DISKGROUP_NAME: "DATA",
          SECTOR_SIZE: 512,
          BLOCK_SIZE: 4096,
          ALLOCATION_UNIT_SIZE: 1048576,
          STATE: "MOUNTED",
          REDUNDANCY_TYPE: "NORMAL",
          TOTAL_MB: 2097152, // 2 TB
          FREE_MB: 629145,   // ~614 GB
          USABLE_FILE_MB: 314572,
          OFFLINE_DISKS: 0,
          USED_PCT: 70.0,
          FREE_PCT: 30.0,
        },
        {
          GROUP_NUMBER: 2,
          DISKGROUP_NAME: "RECO",
          SECTOR_SIZE: 512,
          BLOCK_SIZE: 4096,
          ALLOCATION_UNIT_SIZE: 1048576,
          STATE: "MOUNTED",
          REDUNDANCY_TYPE: "NORMAL",
          TOTAL_MB: 1048576, // 1 TB
          FREE_MB: 419430,   // ~409 GB
          USABLE_FILE_MB: 209715,
          OFFLINE_DISKS: 0,
          USED_PCT: 60.0,
          FREE_PCT: 40.0,
        },
      ] as any;
    }

    // 6. Background Processes
    if (normalized.includes("FROM V$BGPROCESS")) {
      return [
        { PROCESS_NAME: "PMON", DESCRIPTION: "Process Monitor", OS_PID: "10412", STATUS: "RUNNING", PGA_USED_MB: 14.2, PGA_ALLOC_MB: 18.0 },
        { PROCESS_NAME: "SMON", DESCRIPTION: "System Monitor Process", OS_PID: "10414", STATUS: "RUNNING", PGA_USED_MB: 18.5, PGA_ALLOC_MB: 22.0 },
        { PROCESS_NAME: "DBW0", DESCRIPTION: "Database Writer Process 0", OS_PID: "10416", STATUS: "RUNNING", PGA_USED_MB: 48.0, PGA_ALLOC_MB: 54.0 },
        { PROCESS_NAME: "LGWR", DESCRIPTION: "Redo Log Writer Process", OS_PID: "10418", STATUS: "RUNNING", PGA_USED_MB: 32.1, PGA_ALLOC_MB: 38.0 },
        { PROCESS_NAME: "CKPT", DESCRIPTION: "Checkpoint Process", OS_PID: "10420", STATUS: "RUNNING", PGA_USED_MB: 12.0, PGA_ALLOC_MB: 16.0 },
        { PROCESS_NAME: "MMON", DESCRIPTION: "Manageability Monitor", OS_PID: "10422", STATUS: "RUNNING", PGA_USED_MB: 65.4, PGA_ALLOC_MB: 72.0 },
      ] as any;
    }

    // 7. Pluggable Databases
    if (normalized.includes("FROM V$PDBS")) {
      return [
        { CON_ID: 2, DBID: 1002, PDB_NAME: "PDB$SEED", OPEN_MODE: "READ ONLY", RESTRICTED: "NO", TOTAL_SIZE_GB: 1.8, RECOVERY_STATUS: "ENABLED" },
        { CON_ID: 3, DBID: 2001, PDB_NAME: "PDB_FINANCE", OPEN_MODE: "READ WRITE", RESTRICTED: "NO", TOTAL_SIZE_GB: 450.5, RECOVERY_STATUS: "ENABLED" },
        { CON_ID: 4, DBID: 2002, PDB_NAME: "PDB_SALES_CRM", OPEN_MODE: "READ WRITE", RESTRICTED: "NO", TOTAL_SIZE_GB: 320.0, RECOVERY_STATUS: "ENABLED" },
        { CON_ID: 5, DBID: 2003, PDB_NAME: "PDB_AUDIT_LOGS", OPEN_MODE: "READ WRITE", RESTRICTED: "NO", TOTAL_SIZE_GB: 680.2, RECOVERY_STATUS: "ENABLED" },
      ] as any;
    }

    // 8. Per-PDB Metric
    if (normalized.includes("FROM V$RSRC_PDB_METRIC")) {
      return [
        { CON_ID: 3, PDB_NAME: "PDB_FINANCE", CPU_PCT_UTILIZED: 44.8, CPU_CONSUMED_SEC: 1420.5, CPU_WAITING_SEC: 12.4, AVG_RUNNING_SESSIONS: 18.2, AVG_WAITING_SESSIONS: 0.8, IOPS: 2400, IOMBPS: 84.5 },
        { CON_ID: 4, PDB_NAME: "PDB_SALES_CRM", CPU_PCT_UTILIZED: 28.2, CPU_CONSUMED_SEC: 890.1, CPU_WAITING_SEC: 4.1, AVG_RUNNING_SESSIONS: 9.4, AVG_WAITING_SESSIONS: 0.1, IOPS: 1100, IOMBPS: 38.0 },
        { CON_ID: 5, PDB_NAME: "PDB_AUDIT_LOGS", CPU_PCT_UTILIZED: 12.5, CPU_CONSUMED_SEC: 340.2, CPU_WAITING_SEC: 1.2, AVG_RUNNING_SESSIONS: 3.1, AVG_WAITING_SESSIONS: 0.0, IOPS: 450, IOMBPS: 18.2 },
      ] as any;
    }

    // 9. Tablespaces & Headroom
    if (normalized.includes("CDB_DATA_FILES") || normalized.includes("DBA_DATA_FILES")) {
      const isFull = this.scenario === "TABLESPACE_FULL";
      return [
        { CON_ID: 3, PDB_NAME: "PDB_FINANCE", TABLESPACE_NAME: "USERS", ALLOCATED_MB: 204800, USED_MB: isFull ? 201000 : 142000, FREE_MB: isFull ? 3800 : 62800, MAX_SIZE_MB: 204800, TOTAL_HEADROOM_MB: isFull ? 3800 : 62800, USED_PCT_OF_MAX: isFull ? 98.1 : 69.3, IS_AUTOEXTENSIBLE: "NO" },
        { CON_ID: 3, PDB_NAME: "PDB_FINANCE", TABLESPACE_NAME: "UNDOTBS1", ALLOCATED_MB: 32768, USED_MB: 12400, FREE_MB: 20368, MAX_SIZE_MB: 65536, TOTAL_HEADROOM_MB: 53136, USED_PCT_OF_MAX: 18.9, IS_AUTOEXTENSIBLE: "YES" },
        { CON_ID: 4, PDB_NAME: "PDB_SALES_CRM", TABLESPACE_NAME: "CRM_DATA", ALLOCATED_MB: 102400, USED_MB: 71200, FREE_MB: 31200, MAX_SIZE_MB: 204800, TOTAL_HEADROOM_MB: 133600, USED_PCT_OF_MAX: 34.7, IS_AUTOEXTENSIBLE: "YES" },
      ] as any;
    }

    // 10. Top Wait Events & Classes
    if (normalized.includes("FROM V$SYSTEM_EVENT")) {
      return [
        { WAIT_CLASS: "System I/O", TOTAL_WAITS: 1420000, TOTAL_TIME_WAITED_SEC: 1840.2, AVG_WAIT_MS: 1.29 },
        { WAIT_CLASS: "Commit", TOTAL_WAITS: 840000, TOTAL_TIME_WAITED_SEC: 940.5, AVG_WAIT_MS: 1.11 },
        { WAIT_CLASS: "Concurrency", TOTAL_WAITS: 120000, TOTAL_TIME_WAITED_SEC: 412.0, AVG_WAIT_MS: 3.43 },
        { WAIT_CLASS: "Application", TOTAL_WAITS: 45000, TOTAL_TIME_WAITED_SEC: 180.4, AVG_WAIT_MS: 4.01 },
      ] as any;
    }

    // 11. Data Guard Stats
    if (normalized.includes("FROM V$DATAGUARD_STATS")) {
      const isLagging = this.scenario === "DATA_GUARD_LAG";
      return [
        { STAT_NAME: "transport lag", LAG_FORMATTED: isLagging ? "+00 00:14:20" : "+00 00:00:00", UNIT: "day(2) to second(0) interval" },
        { STAT_NAME: "apply lag", LAG_FORMATTED: isLagging ? "+00 00:32:45" : "+00 00:00:01", UNIT: "day(2) to second(0) interval" },
      ] as any;
    }

    return [] as any;
  }

  async ping(): Promise<{ success: boolean; latencyMs: number }> {
    return { success: true, latencyMs: this.latencyMs };
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  isHealthy(): boolean {
    return this.connected;
  }
}
```

---

## 6. Oracle Error Handling & ORA-XXXX Fault Mapping

The collector translates standard Oracle error codes (`ORA-XXXXX`) into standardized Sentinel actionable diagnostic statuses:

| Oracle Error Code | Diagnostic Meaning | Sentinel Severity | Automated Recovery / Action |
| :--- | :--- | :--- | :--- |
| `ORA-12541: TNS:no listener` | Listener down or wrong host/port. | `CRITICAL` | Engage Circuit Breaker; verify host listener service. |
| `ORA-12514: TNS:listener does not currently know of service` | Database service unregistered. | `CRITICAL` | Check database startup or listener registration (`ALTER SYSTEM REGISTER`). |
| `ORA-01017: invalid username/password` | Authentication credential failure. | `CRITICAL` | Silence polling retry to prevent account lockouts (`ORA-28000`). |
| `ORA-00028: your session has been killed` | Active session terminated. | `WARNING` | Reconnect connection pool with exponential backoff. |
| `ORA-01653: unable to extend table by N in tablespace` | Tablespace autoextend ceiling reached. | `CRITICAL` | Trigger immediate DBA Auto-Remediation alert (`ALTER TABLESPACE ADD DATAFILE`). |
| `ORA-00942: table or view does not exist` | Lack of dictionary view grants or Non-ASM / Non-CDB target. | `INFO` / `WARN` | Fallback to standalone equivalent or prompt for `GRANT SELECT_CATALOG_ROLE`. |
| `ORA-01555: snapshot too old` | UNDO tablespace too small or `undo_retention` too low for long queries. | `WARNING` | AI recommendations prompt: increase `undo_retention` and UNDO tablespace size. |
| `ORA-00060: deadlock detected while waiting for resource` | Application lock cyclic deadlock killed by PMON. | `CRITICAL` | Parse trace log / deadlock graph and alert developers with blocking SQL IDs. |

---

## 7. AI DBA Diagnostic Heuristics & Rules Engine

When incidents fire or when a DBA clicks **AI Diagnosis**, the backend synthesizes real-time metrics with rule-based heuristics and Gemini LLM prompt engineering.

### 7.1 Diagnostic Heuristics Matrix

```
                                  +---------------------------------------+
                                  | Oracle Performance Incident Detected |
                                  +---------------------------------------+
                                                      |
                  +-----------------------------------+-----------------------------------+
                  |                                   |                                   |
                  v                                   v                                   v
       [High Wait Class Analysis]          [Memory & Storage Stress]          [Replication / PDB]
                  |                                   |                                   |
    +-------------+-------------+           +---------+---------+               +---------+---------+
    |                           |           |                   |               |                   |
    v                           v           v                   v               v                   v
[log file sync]    [db file seq/scattered] [PGA Over-Alloc] [Tablespace > 90%] [Data Guard Lag] [PDB CPU > Limit]
    |                           |           |                   |               |                   |
    v                           v           v                   v               v                   v
Redo Switch Rate?      Missing Index or FTS?  pga_aggregate_    Autoextend On?  Transport/Apply  Resource Manager
Resize Redo Logs       SQL Tuning Advisor     target Tuning     Add Datafile    MRP Recovery     Plan Directive
```

1. **Rule ORCL-01: Redo Log Checkpoint Bottleneck (`log file sync`)**
   - *Condition*: `topWaitEvents` has `log file sync` in top 3 AND (`redo.switchesLastHour > 10` OR `avgWaitMs > 15ms`).
   - *Root Cause*: High redo switch frequency causing frequent DBWR checkpoints and log buffer contention, or slow storage write speed on redo disks.
   - *Remediation*:
     ```sql
     -- Resize online redo log groups to 4GB to achieve 3-4 switches/hour
     ALTER DATABASE ADD LOGFILE GROUP 4 ('+DATA/ORCLCDB/ONLINELOG/group_4.log') SIZE 4G;
     ALTER DATABASE ADD LOGFILE GROUP 5 ('+DATA/ORCLCDB/ONLINELOG/group_5.log') SIZE 4G;
     ```

2. **Rule ORCL-02: Single/Multi-Block I/O Contention (`db file sequential/scattered read`)**
   - *Condition*: `topWaitClasses` System I/O represents $>50\%$ of total wait time AND buffer cache hit ratio $<95\%$.
   - *Root Cause*: Full table scans (FTS) or unindexed foreign key lookups evicting active blocks from the SGA buffer cache.
   - *Remediation*: Check `V$SQL` for highest `DISK_READS` and `BUFFER_GETS`, generate covering B-Tree index or evaluate `DBMS_STATS.GATHER_TABLE_STATS`.

3. **Rule ORCL-03: Multitenant PDB CPU Starvation**
   - *Condition*: `pdbs.avgWaitingSessions > 2` OR `pdbs.cpuWaitingSec > 20s`.
   - *Root Cause*: Resource Manager plan directive throttling PDB CPU consumption below workload demand.
   - *Remediation*:
     ```sql
     -- Elevate PDB CPU share in active CDB Resource Plan
     BEGIN
       DBMS_RESOURCE_MANAGER.UPDATE_PLAN_DIRECTIVE(
         plan => 'DEFAULT_CDB_PLAN',
         pluggable_database => 'PDB_FINANCE',
         mgmt_p1 => 50,
         utilization_limit => 80
       );
     END;
     /
     ```

4. **Rule ORCL-04: Critical Tablespace Saturation**
   - *Condition*: `tablespaces.usedPctOfMax > 90%` OR `tablespaces.totalHeadroomMb < 5000`.
   - *Root Cause*: Data growth approaching physical file allocation ceiling (`MAXBYTES` or filesystem limit).
   - *Remediation*:
     ```sql
     -- For Smallfile Tablespaces
     ALTER TABLESPACE USERS ADD DATAFILE '+DATA' SIZE 10G AUTOEXTEND ON NEXT 1G MAXSIZE 32G;
     -- For Bigfile Tablespaces
     ALTER TABLESPACE USERS RESIZE 250G;
     ```

5. **Rule ORCL-05: Data Guard Transport or Apply Lag Divergence**
   - *Condition*: `dataGuard.applyLagSeconds > 300` OR `dataGuard.gapStatus != 'NONE'`.
   - *Root Cause*: Standby MRP process stalled, archive log network bottleneck, or gap in transmitted sequence numbers.
   - *Remediation*:
     ```sql
     -- Verify standby alert log and restart Managed Recovery Process
     ALTER DATABASE RECOVER MANAGED STANDBY DATABASE CANCEL;
     ALTER DATABASE RECOVER MANAGED STANDBY DATABASE DISCONNECT FROM SESSION USING CURRENT LOGFILE;
     ```

---

## 8. Dashboard & UI/UX Technical Specifications

The frontend will expand `DatabaseEngineMetrics.tsx` to include an **🏛️ Oracle CDB/PDB** tab with:

1. **Multitenant Container Overview**:
   - Container hierarchy showing `CDB$ROOT` and nested PDB cards (`PDB_FINANCE`, `PDB_SALES_CRM`, etc.).
   - Interactive badge for PDB Open Mode (`READ WRITE`, `READ ONLY`, `RESTRICTED`) and active user sessions.
   - Per-PDB CPU Slice gauge and IOPS meter.
2. **SGA & PGA Memory Distribution Widget**:
   - Dual donut/bar visualizers showing SGA (Buffer Cache vs Shared Pool vs Large Pool vs Free) and PGA (In-Use vs Allocated vs Target).
   - PGA Cache Hit Ratio gauge with warning indicator if $<95\%$.
3. **Redo Log Switch Rate & ASM Headroom**:
   - Sparkline chart of hourly log switches (last 24 hours).
   - Progress meters for ASM Diskgroups (`DATA`, `RECO`) with usable headroom factoring redundancy.
4. **Top Wait Classes Breakdown**:
   - Ranked horizontal bar chart (`System I/O`, `Concurrency`, `Commit`, `Application`).
   - One-click **AI Tune** button on top wait events launching the `AIDiagnosticModal`.
5. **Background Process Health Grid**:
   - Status chips for `PMON`, `SMON`, `DBWR`, `LGWR`, `CKPT`, `MMON`.

---

## 9. Verification & Automated Test Strategy

To verify the Oracle Database monitoring engine:

1. **Unit Tests (`tests/oracle/oracle-collector.test.ts`)**:
   - Verify metric parsing for CDB/PDB multitenant topologies using `MockOracleDriver`.
   - Verify metric parsing for Standalone Non-CDB topologies.
   - Verify calculation of buffer cache hit ratio, SGA/PGA distribution, and autoextend headroom.
2. **Failure Simulation Tests (`tests/oracle/oracle-resilience.test.ts`)**:
   - Test `ORA-12541` network timeout and verify circuit breaker opens without hanging.
   - Test `ORA-01653` and `ORA-00060` error handling and alert generation.
   - Test Data Guard apply lag scenario and verify threshold alert trigger.
3. **AI Diagnostic Integration Tests (`tests/oracle/oracle-ai-diagnose.test.ts`)**:
   - Verify simulated and Gemini LLM prompt generation for `databaseType: "Oracle"`, ensuring proper remediation SQL generation (`ALTER DATABASE ADD LOGFILE...`, `ALTER TABLESPACE...`).
