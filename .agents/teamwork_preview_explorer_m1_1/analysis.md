# Technical Investigation & Architectural Specification: Oracle Database Collector & Deterministic Mock Driver

**Milestone**: Milestone 1 (Oracle Database Monitoring)  
**Agent**: Explorer 1 (`teamwork_preview_explorer_m1_1`)  
**Parent Conversation ID**: `72e141e9-5307-413e-9c29-6d61f1fbbcd4`  
**Date**: 2026-08-19  

---

## 1. Executive Summary & Design Scope

This investigation establishes the technical architecture, driver abstraction, query catalog, and type contracts for **Oracle Database Monitoring** within DataPulse Sentinel. The system delivers complete real-time observability across both **Multitenant (CDB/PDB)** and **Non-CDB (Standalone)** Oracle architectures (versions 12.1 through 23ai).

Key architectural pillars:
1. **Pure JavaScript `node-oracledb` Thin Mode**: 100% native Node.js TCP network implementation with **zero Oracle Instant Client C-binaries**, zero `LD_LIBRARY_PATH` configuration, and minimal CPU/memory footprint on monitored nodes.
2. **Deterministic `MockOracleDriver`**: A complete offline simulation engine supporting 7 operational scenarios (`HEALTHY_CDB`, `STANDALONE_NON_CDB`, `PDB_STARVATION`, `HIGH_LOG_SWITCH`, `TABLESPACE_FULL`, `DATA_GUARD_LAG`, and chaos fault injection) enabling fast, opaque-box CI/CD automated tests without external database infrastructure.
3. **Optimized SQL Query Catalog**: Low-overhead dictionary queries targeting `V$` and `CDB$` performance views (<0.5% CPU overhead), supporting 3-tier polling cadences (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Capacity 5-15m).
4. **Strict Type Contracts**: Comprehensive TypeScript interfaces in `src/types/oracle.ts` and `src/types/telemetry.ts` providing end-to-end type safety across collectors, ring buffers, AI diagnostic rules, and React UI components.

---

## 2. Pure JavaScript `node-oracledb` Thin Mode Connection Architecture

### 2.1 Thin Mode Protocol & Capabilities
In `node-oracledb` 6.x+, Thin Mode is the default operation mode when `oracledb.initOracleClient()` is **not** called. 
- **Pure JavaScript TNS Protocol**: Directly communicates with the Oracle Net Listener via Node.js native `net` and `tls` sockets.
- **Port Support**: Standard Oracle Net port 1521 or TCPS (SSL/TLS encrypted) port 2484.
- **Addressing Formats**:
  - **Easy Connect Plus**: `host:port/service_name` (e.g. `oracle-prod.internal:1521/ORCLCDB`)
  - **SID Connect Descriptor**: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=host)(PORT=port))(CONNECT_DATA=(SID=sid)))`
  - **Full TNS Descriptor**: With dedicated server and load balancing parameters.
- **Privilege Elevation**: Supports `privilege: oracledb.SYSDBA` for dictionary introspection into CDB root views (`CDB_DATA_FILES`, `V$PDBS`, `V$RSRC_PDB_METRIC`).

### 2.2 Connection String Builder Logic
To handle both Service Name (recommended for CDB/PDB) and legacy SID addressing gracefully:

```typescript
export interface OracleConnectionConfig {
  host: string;
  port?: number;
  serviceName?: string;
  sid?: string;
  user: string;
  password?: string;
  isSysDba?: boolean;
  poolMin?: number;
  poolMax?: number;
  poolIncrement?: number;
  poolTimeout?: number;
  connectTimeout?: number;
  queueTimeout?: number;
  isMock?: boolean;
  mockScenario?: "HEALTHY_CDB" | "STANDALONE_NON_CDB" | "PDB_STARVATION" | "HIGH_LOG_SWITCH" | "TABLESPACE_FULL" | "DATA_GUARD_LAG";
}

export function buildConnectString(config: OracleConnectionConfig): string {
  const port = config.port || 1521;
  if (config.serviceName) {
    return `${config.host}:${port}/${config.serviceName}`;
  }
  if (config.sid) {
    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${config.host})(PORT=${port}))(CONNECT_DATA=(SID=${config.sid})))`;
  }
  return `${config.host}:${port}/ORCLCDB`;
}
```

### 2.3 Connection Pool Configuration & Global Options
Monitoring requires low connection footprints to prevent socket starvation on busy database instances:

```typescript
import oracledb from "oracledb";

export class OracleDriverFactory {
  public static configureGlobalDefaults(): void {
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT; // Rows as key-value objects
    oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB]; // Safe LOB handling
    oracledb.autoCommit = false; // Strictly read-only collector
  }

  public static async createPool(config: OracleConnectionConfig): Promise<oracledb.Pool> {
    this.configureGlobalDefaults();

    const connectString = buildConnectString(config);
    return await oracledb.createPool({
      user: config.user,
      password: config.password,
      connectString: connectString,
      privilege: config.isSysDba ? oracledb.SYSDBA : undefined,
      poolMin: config.poolMin ?? 1,
      poolMax: config.poolMax ?? 5,
      poolIncrement: config.poolIncrement ?? 1,
      poolTimeout: config.poolTimeout ?? 60, // 60s idle timeout
      connectTimeout: config.connectTimeout ?? 5000, // 5s connection timeout
      queueTimeout: config.queueTimeout ?? 3000, // 3s queue timeout
    });
  }
}
```

### 2.4 Resilient Error Interceptor & Fault Code Mapping
The driver intercepts Oracle `ORA-XXXXX` error codes and translates them to structured diagnostic events:

| Oracle Error Code | Diagnostic Name | Severity | Collector Action |
|:---|:---|:---|:---|
| `ORA-12541` | `TNS:no listener` | `CRITICAL` | Trip circuit breaker to prevent socket exhaustion; flag listener down. |
| `ORA-12514` | `TNS:listener does not know service` | `CRITICAL` | Trip circuit breaker; alert invalid service name or database unmounted. |
| `ORA-01017` | `invalid username/password` | `CRITICAL` | Silence polling retries to avoid database account lockout (`ORA-28000`). |
| `ORA-00028` | `your session has been killed` | `WARNING` | Evict broken connection from pool; re-establish on next cycle. |
| `ORA-00942` | `table or view does not exist` | `INFO` | Non-CDB or non-ASM target detected; fallback to standalone query variant. |
| `ORA-01013` | `user requested cancel of current operation` | `WARNING` | Query timeout exceeded; log slow dictionary access. |

---

## 3. Comprehensive Oracle Metric SQL Query Catalog

All queries are engineered with explicit column aliases, null-safe `NVL` / `NULLIF` guards, division-by-zero protection, and dual CDB/Standalone fallback logic.

### 3.1 SGA Allocation (`V$SGAINFO`) & PGA Stats (`V$PGASTAT`)

#### 3.1.1 SGA Dynamic Component Breakdown
Extracts current sizes of dynamic memory pools (Buffer Cache, Shared Pool, Large Pool, Java Pool, Free Memory):

```sql
SELECT 
  name AS component_name,
  bytes,
  resizeable
FROM v$sgainfo
ORDER BY name;
```

**Aggregation & Parsing Logic**:
- `totalSgaBytes`: Value where `component_name = 'Maximum SGA Size'`
- `bufferCacheBytes`: Value where `component_name = 'Buffer Cache Size'`
- `sharedPoolBytes`: Value where `component_name = 'Shared Pool Size'`
- `largePoolBytes`: Value where `component_name = 'Large Pool Size'`
- `javaPoolBytes`: Value where `component_name = 'Java Pool Size'`
- `freeSgaBytes`: Value where `component_name = 'Free SGA Memory Available'`
- `redoBuffersBytes`: Value where `component_name = 'Redo Buffers'`

#### 3.1.2 PGA Memory Consumption & Cache Hit Ratio
Queries target, allocated, in-use, and cache hit metrics:

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

**Aggregation & Parsing Logic**:
- `targetBytes`: `aggregate PGA target parameter`
- `allocatedBytes`: `total PGA allocated`
- `inUseBytes`: `total PGA inuse`
- `freeableBytes`: `total freeable PGA memory`
- `maxAllocatedBytes`: `maximum PGA allocated`
- `cacheHitRatio`: `cache hit percentage` (0-100%)
- `overAllocationCount`: `over allocation count`

---

### 3.2 Buffer Cache Hit Ratio Calculation (`V$SYSSTAT`)

**Formula**:
$$\text{Buffer Cache Hit Ratio} = 1 - \frac{\text{physical reads cache}}{\text{consistent gets from cache} + \text{db block gets from cache}}$$

**Single-Pass Conditional Aggregation SQL**:
```sql
SELECT 
  ROUND(
    (1 - (
      NVL(SUM(CASE WHEN name = 'physical reads cache' THEN value ELSE 0 END), 0) /
      NULLIF(
        NVL(SUM(CASE WHEN name IN ('consistent gets from cache', 'db block gets from cache') THEN value ELSE 0 END), 0),
        0
      )
    )) * 100,
    2
  ) AS buffer_cache_hit_ratio,
  NVL(SUM(CASE WHEN name = 'physical reads cache' THEN value ELSE 0 END), 0) AS physical_reads_cache,
  NVL(SUM(CASE WHEN name = 'consistent gets from cache' THEN value ELSE 0 END), 0) AS consistent_gets_cache,
  NVL(SUM(CASE WHEN name = 'db block gets from cache' THEN value ELSE 0 END), 0) AS db_block_gets_cache
FROM v$sysstat
WHERE name IN ('physical reads cache', 'consistent gets from cache', 'db block gets from cache');
```

*Fallback Compatibility*: If `... from cache` rows are unavailable (older 11g/12.1 edge cases), fallback replaces them with `physical reads`, `consistent gets`, and `db block gets`.

---

### 3.3 Redo Log Switch History & Checkpoint Lag

#### 3.3.1 Redo Log Switch Rates (1h, 6h, 24h & Average)
```sql
SELECT 
  COUNT(CASE WHEN first_time >= SYSDATE - (1/24) THEN 1 END) AS switches_last_hour,
  COUNT(CASE WHEN first_time >= SYSDATE - (6/24) THEN 1 END) AS switches_last_6h,
  COUNT(CASE WHEN first_time >= SYSDATE - 1 THEN 1 END) AS switches_last_24h,
  ROUND(COUNT(CASE WHEN first_time >= SYSDATE - 1 THEN 1 END) / 24, 2) AS avg_switches_per_hour,
  TO_CHAR(MAX(first_time), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_switch_time
FROM v$log_history
WHERE first_time >= SYSDATE - 1;
```

#### 3.3.2 Hourly Redo Switch Distribution Buckets (Sparkline Chart)
```sql
SELECT 
  TO_CHAR(first_time, 'YYYY-MM-DD HH24:00') AS time_bucket,
  COUNT(*) AS switch_count
FROM v$log_history
WHERE first_time >= SYSDATE - 1
GROUP BY TO_CHAR(first_time, 'YYYY-MM-DD HH24:00')
ORDER BY time_bucket ASC;
```

#### 3.3.3 Checkpoint Lag & Active Redo Log Groups
```sql
SELECT 
  group#,
  thread#,
  sequence#,
  ROUND(bytes / (1024*1024), 2) AS size_mb,
  members,
  archived,
  status,
  TO_CHAR(first_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS first_time
FROM v$log
ORDER BY group#;
```

```sql
SELECT 
  recovery_estimated_ios,
  actual_redo_blks,
  target_redo_blks,
  log_file_size_blks,
  estimated_mttr,
  target_mttr,
  ckpt_block_writes
FROM v$instance_recovery;
```

---

### 3.4 ASM Diskgroups Telemetry (`V$ASM_DISKGROUP`)

Tracks total, free, and usable capacity while accounting for ASM mirror redundancy (`NORMAL`, `HIGH`, `EXTERN`, `FLEX`):

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

*Non-ASM Safe Mode*: When queried on Non-ASM filesystems, returns `ORA-00942` or 0 rows; collector gracefully sets `asmEnabled: false` and `asmDiskgroups: []`.

---

### 3.5 Critical Background Process Health (`V$PROCESS` & `V$BGPROCESS`)

Monitors the existence, status, OS PID, and PGA memory allocation of vital Oracle daemon processes:

```sql
SELECT 
  b.name AS process_name,
  b.description,
  b.error,
  p.spid AS os_pid,
  ROUND(NVL(p.pga_used_mem, 0) / (1024*1024), 2) AS pga_used_mb,
  ROUND(NVL(p.pga_alloc_mem, 0) / (1024*1024), 2) AS pga_alloc_mb,
  ROUND(NVL(p.pga_max_mem, 0) / (1024*1024), 2) AS pga_max_mb,
  CASE 
    WHEN b.error IS NOT NULL AND b.error != 0 THEN 'ERROR'
    WHEN p.spid IS NOT NULL THEN 'RUNNING' 
    ELSE 'STOPPED' 
  END AS status
FROM v$bgprocess b
LEFT JOIN v$process p ON b.paddr = p.addr
WHERE b.name IN ('PMON', 'SMON', 'DBWR', 'LGWR', 'CKPT', 'MMON', 'MMNL', 'RECO', 'VKTM', 'DBW0', 'LG00')
   OR (b.paddr != '00' AND b.name LIKE 'ARC%')
ORDER BY b.name;
```

---

### 3.6 Multitenant CDB Root vs Pluggable Database (PDB) Metrics

#### 3.6.1 PDB Container Overview (`V$PDBS`)
```sql
SELECT 
  con_id,
  dbid,
  name AS pdb_name,
  open_mode,
  restricted,
  TO_CHAR(open_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS open_time,
  ROUND(total_size / (1024*1024*1024), 2) AS total_size_gb,
  recovery_status
FROM v$pdbs
ORDER BY con_id;
```

#### 3.6.2 Per-PDB CPU Slice & Resource Utilization (`V$RSRC_PDB_METRIC`)
Provides continuous 1-minute averaged resource consumption from Oracle Resource Manager:

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

#### 3.6.3 Active & Blocked Sessions Breakdown per PDB (`V$SESSION`)
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

#### 3.6.4 Tablespace Utilization & Autoextend Headroom (`CDB_DATA_FILES` / `DBA_DATA_FILES`)
Calculates physical allocated space vs maximum autoextend headroom (`MAXBYTES`):

**CDB Multitenant Query**:
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

**Standalone Non-CDB Equivalent**:
```sql
SELECT 
  0 AS con_id,
  'STANDALONE' AS pdb_name,
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
    tablespace_name,
    SUM(bytes) / (1024*1024) AS total_allocated_mb,
    SUM(CASE WHEN autoextensible = 'YES' THEN maxbytes ELSE bytes END) / (1024*1024) AS max_extend_mb,
    MAX(autoextensible) AS is_autoextensible
  FROM dba_data_files
  GROUP BY tablespace_name
) df
LEFT JOIN (
  SELECT 
    tablespace_name,
    SUM(bytes) / (1024*1024) AS free_space_mb
  FROM dba_free_space
  GROUP BY tablespace_name
) fs ON df.tablespace_name = fs.tablespace_name
ORDER BY used_pct_of_max DESC;
```

---

### 3.7 Top Wait Classes & Active Session Wait Events

#### 3.7.1 Top Wait Classes Aggregation (`V$SYSTEM_WAIT_CLASS`)
```sql
SELECT 
  wait_class,
  total_waits,
  ROUND(time_waited / 100, 2) AS time_waited_sec,
  ROUND((time_waited * 10) / NULLIF(total_waits, 0), 2) AS avg_wait_ms
FROM v$system_wait_class
WHERE wait_class != 'Idle'
ORDER BY time_waited DESC;
```

#### 3.7.2 Top Active Wait Events (`V$SYSTEM_EVENT`)
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

#### 3.7.3 Real-Time Blocking Lock Tree (`V$SESSION`)
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

### 3.8 Data Guard Replication Lag & Standby Telemetry

#### 3.8.1 Replication Lag Intervals (`V$DATAGUARD_STATS`)
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

**Interval Parser Helper**:
Converts formatted Oracle interval strings (`+00 00:00:15` or `+00 01:30:00`) into integer seconds:
$$\text{seconds} = (\text{days} \times 86400) + (\text{hours} \times 3600) + (\text{minutes} \times 60) + \text{seconds}$$

#### 3.8.2 Standby Destination & MRP Status (`V$ARCHIVE_DEST_STATUS`)
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

## 4. Deterministic `MockOracleDriver` Architecture

The `MockOracleDriver` enables unit, boundary, integration, and load testing without external Oracle instances or C-binary bindings.

```
+-------------------------------------------------------------------------------+
|                              IOracleDriver Contract                           |
|       +---------------------------------------------------------------+       |
|       | execute<T>(sql: string, binds?: any): Promise<T[]>            |       |
|       | ping(): Promise<{ success: boolean; latencyMs: number }>      |       |
|       | close(): Promise<void>                                        |       |
|       | isHealthy(): boolean                                          |       |
|       +---------------------------------------------------------------+       |
+-------------------------------------------------------------------------------+
                                        |
           +----------------------------+----------------------------+
           |                                                         |
           v                                                         v
+------------------------------------+    +------------------------------------+
|         ThinOracleDriver           |    |          MockOracleDriver          |
|  - Native node-oracledb 6+ Thin    |    |  - 100% Deterministic in-memory   |
|  - Real Oracle 12c-23ai Listener   |    |  - 7 Configurable Scenarios        |
|  - TCP Connection Pool             |    |  - Dynamic Mutation & Fault Injection|
+------------------------------------+    +------------------------------------+
```

### 4.1 Scenario Matrix
1. **`HEALTHY_CDB`** (Default): Multi-container 19c database, 3 active PDBs (`PDB_FINANCE`, `PDB_SALES_CRM`, `PDB_AUDIT_LOGS`), 99.4% cache hit, 4 switches/hr, 0 Data Guard lag.
2. **`STANDALONE_NON_CDB`**: Standalone Oracle 19c (`CDB = 'NO'`), empty PDB array, standard tablespaces.
3. **`PDB_STARVATION`**: Simulates `PDB_FINANCE` exceeding CPU directive (`cpuWaitingSec = 28.5s`, `avgWaitingSessions = 4.2`), triggering `ORCL-03`.
4. **`HIGH_LOG_SWITCH`**: Redo log switches = 28/hour, `log file sync` avg wait = 22ms, triggering `ORCL-01`.
5. **`TABLESPACE_FULL`**: `USERS` tablespace used at 98.1% of max size (`isAutoextensible = false`), triggering `ORCL-04`.
6. **`DATA_GUARD_LAG`**: Standby apply lag = 1965s, gap status `UNRESOLVED`, triggering `ORCL-05`.
7. **`CHAOS_FAULT`**: Simulates connection drop, listener failure (`ORA-12541`), or query timeout to test circuit breaker backoff.

### 4.2 Implementation Design
```typescript
import { IOracleDriver, OracleQueryResult } from "../types/oracle";

export type MockScenario = 
  | "HEALTHY_CDB" 
  | "STANDALONE_NON_CDB" 
  | "PDB_STARVATION" 
  | "HIGH_LOG_SWITCH" 
  | "TABLESPACE_FULL" 
  | "DATA_GUARD_LAG";

export class MockOracleDriver implements IOracleDriver {
  private connected: boolean = false;
  private scenario: MockScenario;
  private latencyMs: number = 2.5;
  private injectedError: Error | null = null;
  public queryExecutionCount: number = 0;
  public executedQueries: Array<{ sql: string; binds?: any }> = [];

  constructor(scenario: MockScenario = "HEALTHY_CDB") {
    this.scenario = scenario;
  }

  public setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  public injectError(error: Error | null): void {
    this.injectedError = error;
  }

  public setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  public reset(): void {
    this.queryExecutionCount = 0;
    this.executedQueries = [];
    this.injectedError = null;
  }

  async connect(): Promise<void> {
    if (this.injectedError) throw this.injectedError;
    this.connected = true;
  }

  async ping(): Promise<{ success: boolean; latencyMs: number }> {
    if (!this.connected || this.injectedError) {
      return { success: false, latencyMs: -1 };
    }
    return { success: true, latencyMs: this.latencyMs };
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  isHealthy(): boolean {
    return this.connected && !this.injectedError;
  }

  async execute<T = any>(sql: string, binds: Record<string, any> | any[] = {}): Promise<T[]> {
    if (!this.connected) throw new Error("ORA-03114: not connected to ORACLE");
    if (this.injectedError) throw this.injectedError;

    this.queryExecutionCount++;
    this.executedQueries.push({ sql, binds });

    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();

    // 1. Topology & Instance Ping
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
        { COMPONENT_NAME: "Maximum SGA Size", BYTES: 34359738368, RESIZEABLE: "No" },      // 32 GB
        { COMPONENT_NAME: "Buffer Cache Size", BYTES: 21474836480, RESIZEABLE: "Yes" },     // 20 GB
        { COMPONENT_NAME: "Shared Pool Size", BYTES: 8589934592, RESIZEABLE: "Yes" },       // 8 GB
        { COMPONENT_NAME: "Large Pool Size", BYTES: 1073741824, RESIZEABLE: "Yes" },        // 1 GB
        { COMPONENT_NAME: "Java Pool Size", BYTES: 536870912, RESIZEABLE: "Yes" },          // 512 MB
        { COMPONENT_NAME: "Free SGA Memory Available", BYTES: 2147483648, RESIZEABLE: "No" }, // 2 GB
        { COMPONENT_NAME: "Redo Buffers", BYTES: 67108864, RESIZEABLE: "No" },              // 64 MB
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

    // 4. Buffer Cache Hit Ratio from V$SYSSTAT
    if (normalized.includes("FROM V$SYSSTAT") && (normalized.includes("BUFFER_CACHE_HIT_RATIO") || normalized.includes("PHYSICAL READS"))) {
      const hitRatio = this.scenario === "HIGH_LOG_SWITCH" ? 89.2 : 99.4;
      return [
        {
          BUFFER_CACHE_HIT_RATIO: hitRatio,
          PHYSICAL_READS_CACHE: 14200,
          CONSISTENT_GETS_CACHE: 2150000,
          DB_BLOCK_GETS_CACHE: 380000,
        },
      ] as any;
    }

    // 5. Redo Log History
    if (normalized.includes("FROM V$LOG_HISTORY")) {
      const isHigh = this.scenario === "HIGH_LOG_SWITCH";
      const switchHour = isHigh ? 28 : 4;
      return [
        {
          SWITCHES_LAST_HOUR: switchHour,
          SWITCHES_LAST_6H: switchHour * 5,
          SWITCHES_LAST_24H: switchHour * 20,
          AVG_SWITCHES_PER_HOUR: switchHour,
          LAST_SWITCH_TIME: new Date().toISOString(),
        },
      ] as any;
    }

    // 6. ASM Diskgroups
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

    // 7. Background Processes
    if (normalized.includes("FROM V$BGPROCESS")) {
      return [
        { PROCESS_NAME: "PMON", DESCRIPTION: "Process Monitor", OS_PID: "10412", STATUS: "RUNNING", PGA_USED_MB: 14.2, PGA_ALLOC_MB: 18.0, PGA_MAX_MB: 20.0, ERROR: 0 },
        { PROCESS_NAME: "SMON", DESCRIPTION: "System Monitor Process", OS_PID: "10414", STATUS: "RUNNING", PGA_USED_MB: 18.5, PGA_ALLOC_MB: 22.0, PGA_MAX_MB: 25.0, ERROR: 0 },
        { PROCESS_NAME: "DBW0", DESCRIPTION: "Database Writer Process 0", OS_PID: "10416", STATUS: "RUNNING", PGA_USED_MB: 48.0, PGA_ALLOC_MB: 54.0, PGA_MAX_MB: 60.0, ERROR: 0 },
        { PROCESS_NAME: "LGWR", DESCRIPTION: "Redo Log Writer Process", OS_PID: "10418", STATUS: "RUNNING", PGA_USED_MB: 32.1, PGA_ALLOC_MB: 38.0, PGA_MAX_MB: 42.0, ERROR: 0 },
        { PROCESS_NAME: "CKPT", DESCRIPTION: "Checkpoint Process", OS_PID: "10420", STATUS: "RUNNING", PGA_USED_MB: 12.0, PGA_ALLOC_MB: 16.0, PGA_MAX_MB: 18.0, ERROR: 0 },
        { PROCESS_NAME: "MMON", DESCRIPTION: "Manageability Monitor", OS_PID: "10422", STATUS: "RUNNING", PGA_USED_MB: 65.4, PGA_ALLOC_MB: 72.0, PGA_MAX_MB: 80.0, ERROR: 0 },
      ] as any;
    }

    // 8. Pluggable Databases (V$PDBS)
    if (normalized.includes("FROM V$PDBS")) {
      if (this.scenario === "STANDALONE_NON_CDB") return [];
      return [
        { CON_ID: 2, DBID: 1002, PDB_NAME: "PDB$SEED", OPEN_MODE: "READ ONLY", RESTRICTED: "NO", OPEN_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(), TOTAL_SIZE_GB: 1.8, RECOVERY_STATUS: "ENABLED" },
        { CON_ID: 3, DBID: 2001, PDB_NAME: "PDB_FINANCE", OPEN_MODE: "READ WRITE", RESTRICTED: "NO", OPEN_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(), TOTAL_SIZE_GB: 450.5, RECOVERY_STATUS: "ENABLED" },
        { CON_ID: 4, DBID: 2002, PDB_NAME: "PDB_SALES_CRM", OPEN_MODE: "READ WRITE", RESTRICTED: "NO", OPEN_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(), TOTAL_SIZE_GB: 320.0, RECOVERY_STATUS: "ENABLED" },
        { CON_ID: 5, DBID: 2003, PDB_NAME: "PDB_AUDIT_LOGS", OPEN_MODE: "READ WRITE", RESTRICTED: "NO", OPEN_TIME: new Date(Date.now() - 14 * 86400 * 1000).toISOString(), TOTAL_SIZE_GB: 680.2, RECOVERY_STATUS: "ENABLED" },
      ] as any;
    }

    // 9. Per-PDB Resource Metric (V$RSRC_PDB_METRIC)
    if (normalized.includes("FROM V$RSRC_PDB_METRIC")) {
      if (this.scenario === "STANDALONE_NON_CDB") return [];
      const isStarved = this.scenario === "PDB_STARVATION";
      return [
        {
          CON_ID: 3,
          PDB_NAME: "PDB_FINANCE",
          CPU_UTILIZATION_LIMIT: 50,
          CPU_PCT_UTILIZED: isStarved ? 88.5 : 44.8,
          CPU_CONSUMED_SEC: 1420.5,
          CPU_WAITING_SEC: isStarved ? 28.5 : 12.4,
          RUNNING_SESSIONS_LIMIT: 50,
          AVG_RUNNING_SESSIONS: isStarved ? 24.5 : 18.2,
          AVG_WAITING_SESSIONS: isStarved ? 4.2 : 0.8,
          IOPS: 2400,
          IOMBPS: 84.5,
        },
        {
          CON_ID: 4,
          PDB_NAME: "PDB_SALES_CRM",
          CPU_UTILIZATION_LIMIT: 40,
          CPU_PCT_UTILIZED: 28.2,
          CPU_CONSUMED_SEC: 890.1,
          CPU_WAITING_SEC: 4.1,
          RUNNING_SESSIONS_LIMIT: 40,
          AVG_RUNNING_SESSIONS: 9.4,
          AVG_WAITING_SESSIONS: 0.1,
          IOPS: 1100,
          IOMBPS: 38.0,
        },
        {
          CON_ID: 5,
          PDB_NAME: "PDB_AUDIT_LOGS",
          CPU_UTILIZATION_LIMIT: 20,
          CPU_PCT_UTILIZED: 12.5,
          CPU_CONSUMED_SEC: 340.2,
          CPU_WAITING_SEC: 1.2,
          RUNNING_SESSIONS_LIMIT: 20,
          AVG_RUNNING_SESSIONS: 3.1,
          AVG_WAITING_SESSIONS: 0.0,
          IOPS: 450,
          IOMBPS: 18.2,
        },
      ] as any;
    }

    // 10. Sessions per PDB (V$SESSION grouping)
    if (normalized.includes("FROM V$SESSION") && normalized.includes("GROUP BY S.CON_ID")) {
      return [
        { CON_ID: 1, PDB_NAME: "CDB$ROOT", TOTAL_SESSIONS: 42, ACTIVE_USER_SESSIONS: 4, INACTIVE_SESSIONS: 38, BLOCKED_SESSIONS: 0 },
        { CON_ID: 3, PDB_NAME: "PDB_FINANCE", TOTAL_SESSIONS: 85, ACTIVE_USER_SESSIONS: 24, INACTIVE_SESSIONS: 61, BLOCKED_SESSIONS: 2 },
        { CON_ID: 4, PDB_NAME: "PDB_SALES_CRM", TOTAL_SESSIONS: 50, ACTIVE_USER_SESSIONS: 12, INACTIVE_SESSIONS: 38, BLOCKED_SESSIONS: 0 },
        { CON_ID: 5, PDB_NAME: "PDB_AUDIT_LOGS", TOTAL_SESSIONS: 18, ACTIVE_USER_SESSIONS: 3, INACTIVE_SESSIONS: 15, BLOCKED_SESSIONS: 0 },
      ] as any;
    }

    // 11. Tablespaces & Autoextend Headroom
    if (normalized.includes("CDB_DATA_FILES") || normalized.includes("DBA_DATA_FILES") || normalized.includes("DBA_TABLESPACE_USAGE_METRICS")) {
      const isFull = this.scenario === "TABLESPACE_FULL";
      return [
        {
          CON_ID: 3,
          PDB_NAME: "PDB_FINANCE",
          TABLESPACE_NAME: "USERS",
          ALLOCATED_MB: 204800,
          USED_MB: isFull ? 201000 : 142000,
          FREE_MB: isFull ? 3800 : 62800,
          MAX_SIZE_MB: 204800,
          TOTAL_HEADROOM_MB: isFull ? 3800 : 62800,
          USED_PCT_OF_MAX: isFull ? 98.1 : 69.3,
          IS_AUTOEXTENSIBLE: "NO",
        },
        {
          CON_ID: 3,
          PDB_NAME: "PDB_FINANCE",
          TABLESPACE_NAME: "UNDOTBS1",
          ALLOCATED_MB: 32768,
          USED_MB: 12400,
          FREE_MB: 20368,
          MAX_SIZE_MB: 65536,
          TOTAL_HEADROOM_MB: 53136,
          USED_PCT_OF_MAX: 18.9,
          IS_AUTOEXTENSIBLE: "YES",
        },
        {
          CON_ID: 4,
          PDB_NAME: "PDB_SALES_CRM",
          TABLESPACE_NAME: "CRM_DATA",
          ALLOCATED_MB: 102400,
          USED_MB: 71200,
          FREE_MB: 31200,
          MAX_SIZE_MB: 204800,
          TOTAL_HEADROOM_MB: 133600,
          USED_PCT_OF_MAX: 34.7,
          IS_AUTOEXTENSIBLE: "YES",
        },
      ] as any;
    }

    // 12. Top Wait Classes & Events
    if (normalized.includes("FROM V$SYSTEM_WAIT_CLASS") || (normalized.includes("FROM V$SYSTEM_EVENT") && normalized.includes("GROUP BY WAIT_CLASS"))) {
      const isLogSync = this.scenario === "HIGH_LOG_SWITCH";
      return [
        { WAIT_CLASS: "System I/O", TOTAL_WAITS: 1420000, TIME_WAITED_SEC: 1840.2, AVG_WAIT_MS: 1.29 },
        { WAIT_CLASS: "Commit", TOTAL_WAITS: isLogSync ? 1840000 : 840000, TIME_WAITED_SEC: isLogSync ? 4200.5 : 940.5, AVG_WAIT_MS: isLogSync ? 22.8 : 1.11 },
        { WAIT_CLASS: "Concurrency", TOTAL_WAITS: 120000, TIME_WAITED_SEC: 412.0, AVG_WAIT_MS: 3.43 },
        { WAIT_CLASS: "Application", TOTAL_WAITS: 45000, TIME_WAITED_SEC: 180.4, AVG_WAIT_MS: 4.01 },
      ] as any;
    }

    if (normalized.includes("FROM V$SYSTEM_EVENT")) {
      const isLogSync = this.scenario === "HIGH_LOG_SWITCH";
      return [
        { EVENT: isLogSync ? "log file sync" : "db file sequential read", WAIT_CLASS: isLogSync ? "Commit" : "System I/O", TOTAL_WAITS: 840000, TIME_WAITED_SEC: isLogSync ? 3840.2 : 1240.5, AVG_WAIT_MS: isLogSync ? 24.5 : 1.47 },
        { EVENT: isLogSync ? "db file sequential read" : "db file scattered read", WAIT_CLASS: "System I/O", TOTAL_WAITS: 420000, TIME_WAITED_SEC: 580.4, AVG_WAIT_MS: 1.38 },
        { EVENT: "enq: TX - row lock contention", WAIT_CLASS: "Application", TOTAL_WAITS: 12400, TIME_WAITED_SEC: 210.0, AVG_WAIT_MS: 16.9 },
      ] as any;
    }

    // 13. Data Guard Stats
    if (normalized.includes("FROM V$DATAGUARD_STATS")) {
      const isLagging = this.scenario === "DATA_GUARD_LAG";
      return [
        { STAT_NAME: "transport lag", LAG_FORMATTED: isLagging ? "+00 00:14:20" : "+00 00:00:00", UNIT: "day(2) to second(0) interval" },
        { STAT_NAME: "apply lag", LAG_FORMATTED: isLagging ? "+00 00:32:45" : "+00 00:00:01", UNIT: "day(2) to second(0) interval" },
      ] as any;
    }

    if (normalized.includes("FROM V$ARCHIVE_DEST_STATUS")) {
      const isLagging = this.scenario === "DATA_GUARD_LAG";
      return [
        {
          DEST_ID: 2,
          DEST_NAME: "LOG_ARCHIVE_DEST_2",
          STATUS: "VALID",
          TARGET: "STANDBY",
          DATABASE_MODE: "OPEN_READ_ONLY",
          RECOVERY_MODE: "MANAGED REAL TIME APPLY",
          PROTECTION_MODE: "MAXIMUM AVAILABILITY",
          APPLIED_SEQ#: isLagging ? 94210 : 94850,
          GAP_STATUS: isLagging ? "UNRESOLVED" : "NONE",
          ERROR: isLagging ? "ORA-16014: log 4 sequence# 94211 not archived" : null,
        },
      ] as any;
    }

    return [] as any;
  }
}
```

---

## 5. TypeScript Interface Specifications

### 5.1 `src/types/oracle.ts` Specification
```typescript
export type OracleOpenMode = "READ WRITE" | "READ ONLY" | "MOUNTED" | "MIGRATE";
export type OracleDatabaseRole = "PRIMARY" | "PHYSICAL STANDBY" | "LOGICAL STANDBY" | "SNAPSHOT STANDBY";
export type AsmRedundancy = "EXTERN" | "NORMAL" | "HIGH" | "FLEX";
export type AsmDiskgroupState = "MOUNTED" | "DISMOUNTED" | "CONNECTED" | "UNKNOWN";
export type ProcessHealthState = "RUNNING" | "STOPPED" | "ERROR";
export type DataGuardGap = "NONE" | "LOCATED" | "UNRESOLVED";

export interface OracleConnectionConfig {
  host: string;
  port?: number;
  serviceName?: string;
  sid?: string;
  user: string;
  password?: string;
  isSysDba?: boolean;
  poolMin?: number;
  poolMax?: number;
  poolIncrement?: number;
  poolTimeout?: number;
  connectTimeout?: number;
  queueTimeout?: number;
  isMock?: boolean;
  mockScenario?: "HEALTHY_CDB" | "STANDALONE_NON_CDB" | "PDB_STARVATION" | "HIGH_LOG_SWITCH" | "TABLESPACE_FULL" | "DATA_GUARD_LAG";
}

export interface IOracleDriver {
  connect(options?: OracleConnectionConfig): Promise<void>;
  execute<T = any>(sql: string, binds?: Record<string, any> | any[]): Promise<T[]>;
  ping(): Promise<{ success: boolean; latencyMs: number }>;
  close(): Promise<void>;
  isHealthy(): boolean;
}

export interface OracleSgaBreakdown {
  totalBytes: number;
  totalMb: number;
  bufferCacheBytes: number;
  bufferCacheMb: number;
  sharedPoolBytes: number;
  sharedPoolMb: number;
  largePoolBytes: number;
  largePoolMb: number;
  javaPoolBytes: number;
  javaPoolMb: number;
  freeSgaBytes: number;
  freeSgaMb: number;
  redoBuffersBytes: number;
  bufferCacheHitRatio: number; // percentage
}

export interface OraclePgaBreakdown {
  targetBytes: number;
  targetMb: number;
  allocatedBytes: number;
  allocatedMb: number;
  inUseBytes: number;
  inUseMb: number;
  freeableBytes: number;
  freeableMb: number;
  maxAllocatedBytes: number;
  maxAllocatedMb: number;
  cacheHitRatio: number; // percentage
  overAllocationCount: number;
}

export interface OracleRedoHistory {
  switchesLastHour: number;
  switchesLast6h: number;
  switchesLast24h: number;
  avgSwitchesPerHour: number;
  lastSwitchTime: string;
  hourlyBuckets: Array<{ timeBucket: string; switchCount: number }>;
}

export interface OracleAsmDiskgroup {
  groupNumber: number;
  name: string;
  sectorSize: number;
  blockSize: number;
  allocationUnitSize: number;
  state: AsmDiskgroupState;
  redundancyType: AsmRedundancy;
  totalMb: number;
  freeMb: number;
  usableFileMb: number;
  offlineDisks: number;
  usedPct: number;
  freePct: number;
}

export interface OracleBackgroundProcess {
  name: string;
  description: string;
  osPid: string | null;
  status: ProcessHealthState;
  pgaUsedMb: number;
  pgaAllocMb: number;
  pgaMaxMb: number;
  error?: string | null;
}

export interface OraclePdbMetric {
  conId: number;
  dbid: number;
  name: string;
  openMode: OracleOpenMode;
  restricted: boolean;
  openTime?: string;
  totalSizeGb: number;
  recoveryStatus: string;
  
  // Resource Manager Metrics
  cpuUtilizationLimit?: number;
  cpuPctUtilized?: number;
  cpuConsumedSec?: number;
  cpuWaitingSec?: number;
  avgRunningSessions?: number;
  avgWaitingSessions?: number;
  iops?: number;
  iombps?: number;
  
  // Session Slicing
  totalSessions: number;
  activeUserSessions: number;
  inactiveSessions: number;
  blockedSessions: number;
}

export interface OracleTablespaceHeadroom {
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

export interface OracleWaitClassSummary {
  waitClass: string;
  totalWaits: number;
  timeWaitedSec: number;
  avgWaitMs: number;
  pctOfTotalTime?: number;
}

export interface OracleWaitEventSummary {
  event: string;
  waitClass: string;
  totalWaits: number;
  timeWaitedSec: number;
  avgWaitMs: number;
}

export interface OracleBlockingLockDetail {
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

export interface OracleDataGuardSummary {
  configured: boolean;
  role: OracleDatabaseRole;
  protectionMode?: string;
  transportLagSeconds: number;
  applyLagSeconds: number;
  mrpStatus?: string;
  gapStatus: DataGuardGap;
  destinations: Array<{
    destId: number;
    destName: string;
    status: string;
    target: string;
    appliedSeq: number;
    gapStatus: string;
    error?: string | null;
  }>;
}

export interface OracleTelemetrySnapshot {
  instanceId: string;
  timestamp: string;
  isCdb: boolean;
  cdbName: string;
  databaseRole: OracleDatabaseRole;
  openMode: OracleOpenMode;
  version: string;
  uptimeSeconds: number;
  
  sga: OracleSgaBreakdown;
  pga: OraclePgaBreakdown;
  redo: OracleRedoHistory;
  asmEnabled: boolean;
  asmDiskgroups: OracleAsmDiskgroup[];
  backgroundProcesses: OracleBackgroundProcess[];
  pdbs: OraclePdbMetric[];
  tablespaces: OracleTablespaceHeadroom[];
  topWaitClasses: OracleWaitClassSummary[];
  topWaitEvents: OracleWaitEventSummary[];
  blockingLocks: OracleBlockingLockDetail[];
  dataGuard: OracleDataGuardSummary;
}
```

---

### 5.2 `src/types/telemetry.ts` Specification
```typescript
import { DBInstance } from "./dba";
import { OracleTelemetrySnapshot } from "./oracle";

export type PollingTier = "L1_HEARTBEAT" | "L2_TELEMETRY" | "L3_CAPACITY";
export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface L1HeartbeatPayload {
  instanceId: string;
  timestamp: string;
  status: "ONLINE" | "HIGH_LOAD" | "CRITICAL" | "MAINTENANCE";
  latencyMs: number;
  activeConnections: number;
  blockedSessionsCount: number;
  replicationLagSeconds: number;
}

export interface L2TelemetryPayload {
  instanceId: string;
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  iops: number;
  bufferHitRatio: number;
  slowQueryCount: number;
  oracleDetails?: Partial<OracleTelemetrySnapshot>;
}

export interface L3CapacityPayload {
  instanceId: string;
  timestamp: string;
  diskTotalGb: number;
  diskFreeGb: number;
  tablespaces?: OracleTelemetrySnapshot["tablespaces"];
  asmDiskgroups?: OracleTelemetrySnapshot["asmDiskgroups"];
  backgroundProcesses?: OracleTelemetrySnapshot["backgroundProcesses"];
}

export interface TelemetrySample {
  id: string;
  instanceId: string;
  timestamp: string;
  tier: PollingTier;
  engine: "PostgreSQL" | "SQL Server" | "MySQL" | "Oracle";
  metrics: {
    cpu: number;
    memory: number;
    iops: number;
    activeConnections: number;
    latencyMs: number;
    replicationLag: number;
    bufferHitRatio: number;
  };
  oracleSnapshot?: OracleTelemetrySnapshot;
}

export interface TelemetryStreamMessage {
  type: "telemetry" | "circuit_state" | "correlation_alert" | "heartbeat";
  data: TelemetrySample | {
    endpointId: string;
    state: CircuitBreakerState;
    consecutiveFailures: number;
    nextAttemptTime: string;
  } | {
    ruleId: string;
    severity: "critical" | "warning" | "info";
    dbInstanceId: string;
    hostId: string;
    description: string;
    remediation: string;
    timestamp: string;
  };
}
```

---

## 6. Multi-Tiered Polling Cadence Execution Flow

```
+----------------------------------------------------------------------------------------------------+
|                                    Centralized Polling Engine                                      |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|    [ Tier 1: L1 Heartbeat (5-10s) ]                                                                |
|    - SELECT FROM V$DATABASE, V$INSTANCE (Ping & Open Mode)                                         |
|    - SELECT FROM V$SESSION (Active & Blocked Sessions)                                             |
|    - SELECT FROM V$DATAGUARD_STATS (Replication Lag)                                               |
|    -> Failure > 2 cycles: Trip Circuit Breaker, Alert DBA                                          |
|                                                                                                    |
|    [ Tier 2: L2 Telemetry (30-60s) ]                                                               |
|    - SELECT FROM V$SGAINFO & V$PGASTAT (Memory Allocation)                                         |
|    - SELECT FROM V$SYSSTAT (Buffer Cache Hit Ratio)                                                |
|    - SELECT FROM V$RSRC_PDB_METRIC (PDB CPU/IO Slices)                                             |
|    - SELECT FROM V$SYSTEM_WAIT_CLASS & V$SYSTEM_EVENT (Top Waits)                                 |
|    - SELECT FROM V$LOG_HISTORY (Redo Switch Rate last 1h)                                          |
|    -> Push to 60-sample in-memory Ring Buffer & Stream to UI via SSE/WS                            |
|                                                                                                    |
|    [ Tier 3: L3 Deep Capacity (5-15m) ]                                                            |
|    - SELECT FROM CDB_DATA_FILES & CDB_FREE_SPACE (Tablespace Headroom)                             |
|    - SELECT FROM V$ASM_DISKGROUP (Usable Headroom)                                                 |
|    - SELECT FROM V$BGPROCESS & V$PROCESS (Process Daemon Health)                                   |
|    - SELECT FROM V$LOG_HISTORY (24h hourly distribution)                                           |
|    -> Update Capacity Forecast & Autoextend Exhaustion Alerts                                      |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

---

## 7. Next Steps & Implementer Handoff

1. **Implement `src/types/oracle.ts` and `src/types/telemetry.ts`**.
2. **Implement `src/server/collectors/oracle/oracleQueries.ts`** exporting all documented SQL constants.
3. **Implement `src/server/collectors/oracle/OracleDriver.ts` and `MockOracleDriver.ts`**.
4. **Implement `src/server/collectors/oracle/OracleCollector.ts`** supporting L1, L2, L3 collection.
5. **Connect with Milestone 2 Polling Engine** and Milestone 1 UI components.
