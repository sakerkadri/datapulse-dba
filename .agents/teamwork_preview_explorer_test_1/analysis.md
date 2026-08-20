# Technical Analysis & Test Specification: Oracle Metric Collection & Parsing

**Agent**: `teamwork_preview_explorer_test_1` (Explorer 1, Milestone 4: E2E Test Suite & Test Infrastructure)  
**Target Test Suite**: `tests/unit/oracleCollector.test.ts`  
**Date**: 2026-08-19  
**Status**: Completed Test Architecture & Specification  

---

## 1. Executive Summary & Test Mission

The mission of Explorer 1 is to design the comprehensive unit, boundary, integration, and failure test suite (`tests/unit/oracleCollector.test.ts`) for Oracle Database telemetry collection in DataPulse DBA Sentinel.

The test suite must verify that:
1. **Multitenant (CDB/PDB) & Standalone (Non-CDB) topologies** are accurately recognized, parsed, and mapped into DataPulse domain models without data corruption.
2. **All 8 Oracle Telemetry Domains** (Topology/Health, PDB Container Slicing, SGA/PGA Memory, Tablespace Headroom, Redo Log Switches, ASM Diskgroups, Background Process Health, Wait Events/Classes, and Data Guard Replication) calculate correct metrics and mathematical ratios.
3. **Multi-Tier Cadence Partitioning** (L1 Heartbeat 5–10s, L2 Telemetry 30–60s, L3 Deep Capacity 5–15m) dispatches only the queries scoped for that tier.
4. **Mock Driver Fallback & Error Resilience** deterministically simulate realistic Oracle behaviors, handling `ORA-XXXX` errors, network timeouts, authentication rejections, and connection drops gracefully.
5. **Zero-Dependency Execution**: The test suite runs natively via Node.js test runner (`npx tsx --test`) in CI/CD without requiring live Oracle database servers or external C++ binary bindings.

---

## 2. Oracle Metric Domains & Parser Logic Analysis

### 2.1 Database & Topology Introspection
- **Target Views**: `V$DATABASE`, `V$INSTANCE`
- **Key Fields**:
  - `CDB`: `"YES"` (Multitenant CDB) vs `"NO"` (Non-CDB Standalone).
  - `DATABASE_ROLE`: `"PRIMARY"`, `"PHYSICAL STANDBY"`, `"LOGICAL STANDBY"`.
  - `OPEN_MODE`: `"READ WRITE"`, `"READ ONLY"`, `"MOUNTED"`.
  - `STARTUP_TIME` / `UPTIME_SECONDS`: Calculated from `(SYSDATE - startup_time) * 86400`.
- **Parsing Invariants**:
  - If `CDB === "YES"`, the collector sets `isCdb = true` and enables PDB queries.
  - If `CDB === "NO"`, the collector sets `isCdb = false`, sets `pdbs = []`, and directs tablespace queries to `DBA_DATA_FILES`/`DBA_FREE_SPACE`.

### 2.2 Multitenant Container Architecture (CDB & PDBs)
- **Target Views**: `V$PDBS`, `V$RSRC_PDB_METRIC`, `V$SESSION`
- **Key Fields & Math**:
  - Container IDs: `con_id = 1` (`CDB$ROOT`), `con_id = 2` (`PDB$SEED`), `con_id >= 3` (User Pluggable Databases).
  - Active vs Inactive vs Blocked Sessions: Aggregated per `con_id` from `V$SESSION`.
  - CPU Utilization: `avg_cpu_utilization` (as percentage), `cpu_consumed_time` (converted to seconds), `cpu_waiting_time` (seconds in queue).
  - Open Mode: `"READ WRITE"`, `"READ ONLY"`, `"MOUNTED"`, `"MIGRATE"`.
  - Restricted Status: `"YES"`/`"NO"` or boolean.

### 2.3 SGA & PGA Dynamic Memory Architecture
- **Target Views**: `V$SGAINFO`, `V$SYSSTAT`, `V$PGASTAT`
- **Key Fields & Math**:
  - SGA Dynamic Pools (in MB):
    - Buffer Cache: `bytes / (1024 * 1024)` from `COMPONENT_NAME = 'Buffer Cache Size'`
    - Shared Pool: `bytes / (1024 * 1024)` from `COMPONENT_NAME = 'Shared Pool Size'`
    - Large Pool: `bytes / (1024 * 1024)` from `COMPONENT_NAME = 'Large Pool Size'`
    - Free Memory: `bytes / (1024 * 1024)` from `COMPONENT_NAME = 'Free SGA Memory Available'`
    - Total SGA: `bytes / (1024 * 1024)` from `COMPONENT_NAME = 'Maximum SGA Size'`
  - Buffer Cache Hit Ratio Formula:
    $$\text{Hit Ratio (\%)} = \left(1 - \frac{\text{physical reads}}{\text{db block gets} + \text{consistent gets}}\right) \times 100$$
    *Boundary check*: If `(db block gets + consistent gets) === 0`, return `100.0` (prevent `NaN` / division by zero).
  - PGA Metrics:
    - `pgaTargetMb`: from `'aggregate PGA target parameter'`
    - `pgaAllocatedMb`: from `'total PGA allocated'`
    - `pgaInUseMb`: from `'total PGA inuse'`
    - `pgaFreeableMb`: from `'total freeable PGA memory'`
    - `pgaMaxAllocatedMb`: from `'maximum PGA allocated'`
    - `cacheHitPercentage`: from `'cache hit percentage'`
    - `overAllocationCount`: from `'over allocation count'` (indicates PGA memory exhaustion)

### 2.4 Tablespaces, Autoextend & Storage Headroom
- **Target Views**: `CDB_DATA_FILES` / `DBA_DATA_FILES`, `CDB_FREE_SPACE` / `DBA_FREE_SPACE`
- **Key Fields & Math**:
  - `allocated_mb`: $\sum \text{bytes} / (1024 \times 1024)$
  - `max_size_mb`: $\sum (\text{IF autoextensible = 'YES' THEN maxbytes ELSE bytes END}) / (1024 \times 1024)$
  - `free_mb`: $\sum \text{free\_space\_bytes} / (1024 \times 1024)$ (default $0$ if tablespace is 100% full with no free space rows)
  - `used_mb`: $\text{allocated\_mb} - \text{free\_mb}$
  - `total_headroom_mb`: $\text{max\_size\_mb} - \text{used\_mb}$
  - `used_pct_of_max`: $\left(\frac{\text{used\_mb}}{\max(\text{max\_size\_mb}, 1)}\right) \times 100$
- **Threshold Rules**:
  - `WARNING`: `used_pct_of_max >= 85%` OR `total_headroom_mb < 10240` (10 GB)
  - `CRITICAL`: `used_pct_of_max >= 95%` OR `total_headroom_mb < 2048` (2 GB)

### 2.5 Redo Log Switch Rates & Checkpoint Sizing
- **Target Views**: `V$LOG_HISTORY`
- **Key Fields**:
  - `switchesLastHour`: Count of switches in last 60 minutes.
  - `switchesLast6h`: Count of switches in last 6 hours.
  - `switchesLast24h`: Count of switches in last 24 hours.
  - `avgSwitchesPerHour`: `switchesLast24h / 24`.
  - `hourlyHistory`: Time-bucketed distribution array `[{ timeBucket: '2026-08-19 16:00', switchCount: 4 }, ...]`.
- **Heuristic**:
  - Normal: 2–5 switches/hour.
  - High / Checkpoint Spike: $> 10$ switches/hour.

### 2.6 ASM Diskgroups & Redundancy
- **Target Views**: `V$ASM_DISKGROUP`
- **Key Fields & Math**:
  - `totalMb`, `freeMb`, `usableFileMb`.
  - Redundancy Types: `"EXTERN"` (1x), `"NORMAL"` (2x mirror), `"HIGH"` (3x mirror), `"FLEX"`.
  - `offlineDisks`: Flag if $> 0$.
  - Non-ASM Graceful Handling: Returns empty array `[]` and `asmEnabled: false` when query fails with `ORA-00942` or returns 0 rows.

### 2.7 Critical Background Processes
- **Target Views**: `V$BGPROCESS`, `V$PROCESS`
- **Processes Monitored**: `PMON`, `SMON`, `DBWR` / `DBW0`, `LGWR`, `CKPT`, `MMON`, `MMNL`, `VKTM`, `RECO`.
- **Status Evaluation**:
  - `"RUNNING"`: `osPid !== null` and `error === null`.
  - `"STOPPED"`: `osPid === null`.
  - `"ERROR"`: `error !== null`.

### 2.8 Top Wait Classes, Wait Events & Blocking Lock Tree
- **Target Views**: `V$SYSTEM_EVENT`, `V$SESSION`
- **Key Fields & Math**:
  - Wait Classes (excluding `'Idle'`): `"System I/O"`, `"Concurrency"`, `"Commit"`, `"Application"`, `"Configuration"`, `"Network"`, `"User I/O"`, `"Other"`.
  - `pctOfTotalTime`: `(timeWaitedSec / sumOfAllTimeWaitedSec) * 100`.
  - Top Wait Events: Individual events ranked by `time_waited_micro DESC` (e.g. `log file sync`, `db file sequential read`, `enq: TX - row lock contention`, `buffer busy waits`).
  - Blocking Lock Tree: Self-join on `V$SESSION` where `blocking_session IS NOT NULL` capturing `blockerSid`, `blockerSerial`, `blockerUsername`, `blockedSid`, `secondsInWait`, `waitEvent`.

### 2.9 Data Guard Replication Lag & Standby Telemetry
- **Target Views**: `V$DATAGUARD_STATS`, `V$ARCHIVE_DEST_STATUS`
- **Parsing**:
  - Interval string parser: Converts Oracle `"+00 00:14:20"` or `"+00 00:00:00.000"` to total seconds integer.
  - Standby MRP process status and sequence gap detection (`"NONE"`, `"LOCATED"`, `"UNRESOLVED"`).

---

## 3. Mock Driver Architecture & Fixture Design

To ensure test isolation without requiring a live Oracle instance, the test suite leverages `MockOracleDriver` and custom query mocking.

### 3.1 Driver Contract
```typescript
export interface IOracleDriver {
  connect(options?: any): Promise<void>;
  query<T = any>(sql: string, binds?: Record<string, any> | any[]): Promise<T[]>;
  execute?<T = any>(sql: string, binds?: Record<string, any>): Promise<T[]>;
  ping(): Promise<{ success: boolean; latencyMs: number }>;
  close(): Promise<void>;
  isHealthy(): boolean;
}
```

### 3.2 Mock Driver Scenarios Matrix
The `MockOracleDriver` supports configurable preset scenarios:

| Scenario Name | Description | Key Simulated Values |
|---|---|---|
| `HEALTHY_CDB` | Multitenant 19c Enterprise with 3 user PDBs | `CDB='YES'`, 4 PDBs, Buffer Hit 98.4%, Redo 4/hr, 0 offline disks, Data Guard synced (0s lag), 0 blocking locks |
| `STANDALONE_NON_CDB` | Standalone 19c Non-CDB instance | `CDB='NO'`, `V$PDBS` returns empty, DBA_* views used, Buffer Hit 99.1% |
| `PDB_STARVATION` | Multitenant PDB with CPU throttling | `PDB_FINANCE` with `avg_waiting_sessions = 3.5`, `cpu_waiting_sec = 45.2s`, `cpu_utilization_pct = 95.0%` |
| `HIGH_LOG_SWITCH` | Redo log checkpoint bottleneck | `switchesLastHour = 28`, top wait event `log file sync` (avg wait 22ms) |
| `TABLESPACE_FULL` | Critical tablespace saturation | `USERS` tablespace at 98.1% of max size, `totalHeadroomMb = 1800MB`, autoextend disabled |
| `DATA_GUARD_LAG` | Standby replication lag | `applyLagSeconds = 1965` (32m 45s), `transportLagSeconds = 860` (14m 20s) |
| `BLOCKING_LOCKS` | Active session contention | Session 142 (`SYS`) blocking Session 205 (`APP_USER`) on `enq: TX - row lock contention` for 180s |
| `NON_ASM_SYSTEM` | Standard filesystem storage | `V$ASM_DISKGROUP` query throws `ORA-00942` or returns empty array |
| `AUTH_FAILURE` | Invalid database credentials | Driver `connect()` or `query()` rejects with `ORA-01017: invalid username/password` |
| `CONNECTION_TIMEOUT` | Unreachable listener / network drop | Driver `connect()` or `query()` rejects with `ORA-12541: TNS:no listener` after timeout |
| `DEADLOCK_DETECTED` | Application cyclic lock deadlock | Driver query returns `ORA-00060: deadlock detected while waiting for resource` |

---

## 4. Comprehensive Test Case Inventory (Tiers 1–4)

### Tier 1: Unit Tests — Happy Path & Metric Parser Functions (≥10 Tests)

- **Test 1.1: CDB Topology & Database Introspection**
  - Input: Rows from `V$DATABASE` + `V$INSTANCE` with `CDB = 'YES'`, version `19.22.0.0.0`, role `PRIMARY`.
  - Assertions: `isCdb === true`, `databaseRole === 'PRIMARY'`, `version === '19.22.0.0.0'`, `uptimeSeconds > 0`, `status === 'ONLINE'`.

- **Test 1.2: Standalone Non-CDB Topology Fallback**
  - Input: Rows from `V$DATABASE` + `V$INSTANCE` with `CDB = 'NO'`.
  - Assertions: `isCdb === false`, `pdbs.length === 0`, `tablespaces` parsed using `DBA_DATA_FILES`.

- **Test 1.3: Multitenant PDB Slicing & Container Metrics**
  - Input: 4 PDBs (`PDB$SEED`, `PDB_FINANCE`, `PDB_SALES_CRM`, `PDB_AUDIT_LOGS`) joined with `V$RSRC_PDB_METRIC` and `V$SESSION`.
  - Assertions: Correct mapping of `conId`, `pdbName`, `openMode`, `totalSizeGb`, `activeSessions`, `cpuUtilizationPct`, and `iops` for each PDB.

- **Test 1.4: SGA Dynamic Memory Allocation & Pool Sizing**
  - Input: `V$SGAINFO` containing Maximum SGA (32GB), Buffer Cache (20GB), Shared Pool (8GB), Large Pool (1GB), Free (2GB).
  - Assertions: `sga.totalMb === 32768`, `sga.bufferCacheMb === 20480`, `sga.sharedPoolMb === 8192`, `sga.largePoolMb === 1024`, `sga.freeSgaMb === 2048`.

- **Test 1.5: Buffer Cache Hit Ratio Mathematical Precision**
  - Input: `physical reads = 120,000`, `db block gets = 2,500,000`, `consistent gets = 5,000,000`.
  - Formula: $(1 - (120000 / 7500000)) \times 100 = 98.4\%$.
  - Assertions: `bufferCacheHitRatio === 98.4`.

- **Test 1.6: PGA Memory & Cache Hit Percentage Parsing**
  - Input: `V$PGASTAT` with target 16GB, allocated 12GB, in-use 9GB, freeable 2GB, cache hit 98.4%, over-allocation 0.
  - Assertions: `pga.targetMb === 16384`, `pga.allocatedMb === 12288`, `pga.inUseMb === 9216`, `pga.cacheHitRatio === 98.4`, `pga.overAllocationCount === 0`.

- **Test 1.7: Tablespace Autoextend Headroom & Saturation**
  - Input: `USERS` tablespace with `allocated_mb = 204800`, `free_mb = 62800`, `max_size_mb = 204800`, `autoextensible = 'NO'`.
  - Assertions: `usedMb === 142000`, `totalHeadroomMb === 62800`, `usedPctOfMax === 69.33`, `isAutoextensible === false`.

- **Test 1.8: Redo Log Switch Frequency Calculation**
  - Input: `V$LOG_HISTORY` with `switches_last_hour = 4`, `switches_last_6h = 20`, `switches_last_24h = 80`.
  - Assertions: `redo.switchesLastHour === 4`, `redo.switchesLast6h === 20`, `redo.switchesLast24h === 80`, `redo.avgSwitchesPerHour === 3.33`.

- **Test 1.9: ASM Diskgroup Usable Headroom & Redundancy**
  - Input: `V$ASM_DISKGROUP` with `DATA` (2TB total, 614GB free, `NORMAL` redundancy, 0 offline disks).
  - Assertions: `asmDiskgroups[0].name === 'DATA'`, `redundancyType === 'NORMAL'`, `usedPct === 70.0`, `freePct === 30.0`, `offlineDisks === 0`.

- **Test 1.10: Background Process Status & Memory Attribution**
  - Input: `PMON`, `SMON`, `DBW0`, `LGWR`, `CKPT`, `MMON` rows with OS PIDs and PGA MB.
  - Assertions: All core background processes marked `"RUNNING"` with correct `osPid` and `pgaUsedMb`.

- **Test 1.11: Top Wait Classes Aggregation & Percentages**
  - Input: Wait classes `"System I/O"` (1840s), `"Commit"` (940s), `"Concurrency"` (412s), `"Application"` (180s).
  - Assertions: Total wait time = 3372.6s; `pctOfTotalTime` calculated accurately (System I/O ~54.6%, Commit ~27.9%).

- **Test 1.12: Data Guard Formatted Interval String Parsing**
  - Input: `STAT_NAME = 'apply lag'`, `LAG_FORMATTED = '+00 00:32:45'`; `STAT_NAME = 'transport lag'`, `LAG_FORMATTED = '+00 00:14:20'`.
  - Assertions: `applyLagSeconds === 1965`, `transportLagSeconds === 860`.

---

### Tier 2: Boundary & Edge Case Tests (≥8 Tests)

- **Test 2.1: Buffer Cache Hit Ratio Division by Zero Protection**
  - Input: `physical reads = 0`, `db block gets = 0`, `consistent gets = 0`.
  - Assertions: `bufferCacheHitRatio === 100.0` (does not return `NaN` or crash).

- **Test 2.2: 100% Saturated Tablespace with NULL Free Space**
  - Input: Tablespace where `CDB_FREE_SPACE` returns 0 rows (no free extents).
  - Assertions: `freeMb === 0`, `usedMb === allocatedMb`, `usedPctOfMax === 100.0`, `totalHeadroomMb === 0`.

- **Test 2.3: Non-ASM Environment Handling**
  - Input: `V$ASM_DISKGROUP` query returns empty array or throws `ORA-00942`.
  - Assertions: `asmEnabled === false`, `asmDiskgroups.length === 0`, collector finishes without throwing unhandled rejection.

- **Test 2.4: Empty PDB Fleet (Root & Seed Only)**
  - Input: `V$PDBS` returns only `con_id = 1` and `con_id = 2` (`PDB$SEED`).
  - Assertions: `pdbs.length === 0` (or seed filtered appropriately), zero active user sessions.

- **Test 2.5: Background Process Failure & Missing PID**
  - Input: `SMON` row with `spid = null` and `error = 'ORA-00445'`.
  - Assertions: `backgroundProcesses.find(p => p.name === 'SMON').status === 'STOPPED'` or `'ERROR'`.

- **Test 2.6: Active Blocking Lock Chain**
  - Input: Session 142 blocking Session 205 on `enq: TX - row lock contention` for 180 seconds.
  - Assertions: `blockingLocks.length === 1`, `blockingLocks[0].blockerSid === 142`, `blockingLocks[0].blockedSid === 205`, `secondsInWait === 180`.

- **Test 2.7: Autoextensible Tablespace with Maxbytes > Allocated**
  - Input: `allocated_mb = 32768`, `free_mb = 20368`, `max_size_mb = 65536`, `is_autoextensible = 'YES'`.
  - Assertions: `usedMb === 12400`, `totalHeadroomMb === 53136`, `usedPctOfMax === 18.92`.

- **Test 2.8: PGA Over-Allocation Alert Flag**
  - Input: `V$PGASTAT` with `'over allocation count' = 42`.
  - Assertions: `pga.overAllocationCount === 42`.

---

### Tier 3: Integration Tests — Cadence Tiers & Collector Workflow (≥6 Tests)

- **Test 3.1: L1 Heartbeat Collection Isolation**
  - Action: Execute `collectL1Heartbeat(instance)`.
  - Assertions:
    - Returns lightweight ping status, uptime, active sessions, and Data Guard lag.
    - Does NOT execute L3 queries (`CDB_DATA_FILES`, `V$ASM_DISKGROUP`, `V$LOG_HISTORY`).
    - Execution time $< 15\text{ms}$ with `MockOracleDriver`.

- **Test 3.2: L2 Telemetry Collection Integration**
  - Action: Execute `collectL2Telemetry(instance)`.
  - Assertions:
    - Returns SGA/PGA memory distribution, buffer cache hit ratio, per-PDB CPU slices, top wait classes, and last hour redo switches.
    - Accurately integrates into `DBInstance.engineSpecific`.

- **Test 3.3: L3 Deep Capacity Collection Integration**
  - Action: Execute `collectL3Capacity(instance)`.
  - Assertions:
    - Returns full tablespace headroom catalog, ASM diskgroups, background processes, and 24h redo distribution history.

- **Test 3.4: Complete Metric Aggregation Pipeline (`collectAllMetrics`)**
  - Action: Execute end-to-end collection across all tiers for a CDB instance.
  - Assertions:
    - Target `DBInstance` object is fully populated with both top-level metrics (`cpuUsage`, `memoryUsage`, `iops`, `activeConnections`, `queryLatencyMs`, `bufferHitRatio`) and nested `engineSpecific` Oracle details.

- **Test 3.5: Dynamic Scenario Switching in Mock Driver**
  - Action: Transition `MockOracleDriver` from `HEALTHY_CDB` $\to$ `TABLESPACE_FULL` $\to$ `DATA_GUARD_LAG`.
  - Assertions:
    - First run: Tablespace USERS usedPct < 70%, Data Guard lag = 0.
    - Second run: Tablespace USERS usedPct > 98%, warning/critical flag raised.
    - Third run: Data Guard applyLagSeconds = 1965s, replication lag reflected in top-level `replicationLagSeconds`.

- **Test 3.6: Concurrent Collector Execution**
  - Action: Execute `Promise.all()` with 10 concurrent collection requests on separate Oracle instance configs.
  - Assertions:
    - All 10 promises resolve cleanly with zero cross-instance state bleeding or race conditions.

---

### Tier 4: Failure Scenarios, Error Handling & Load Tests (≥6 Tests)

- **Test 4.1: Connection Timeout & Unreachable Listener (`ORA-12541`)**
  - Setup: `MockOracleDriver` configured to simulate `ORA-12541: TNS:no listener`.
  - Action: Execute `collectL1Heartbeat()`.
  - Assertions:
    - Collector catches error gracefully.
    - Returns status `CRITICAL` or `UNREACHABLE` without throwing unhandled promise rejection.
    - Records error details in health check status.

- **Test 4.2: Authentication Failure (`ORA-01017`)**
  - Setup: `MockOracleDriver` configured to simulate `ORA-01017: invalid username/password`.
  - Action: Execute `collectL1Heartbeat()`.
  - Assertions:
    - Correctly categorizes error as credential/auth failure.
    - Sets instance status to `CRITICAL`.

- **Test 4.3: Connection Loss Mid-Query (`ORA-00028`)**
  - Setup: Driver simulates session termination during query execution.
  - Action: Collector catches session disconnect and marks driver for reconnect.
  - Assertions:
    - `isHealthy()` returns `false`.

- **Test 4.4: Tablespace Quota Exhaustion (`ORA-01653`) Error Handling**
  - Setup: Driver query throws `ORA-01653: unable to extend table`.
  - Action: Collector captures tablespace error and maps it to storage alert.
  - Assertions:
    - Diagnostic alert generated with remediation hint (`ALTER TABLESPACE ... ADD DATAFILE`).

- **Test 4.5: Deadlock Incident Mapping (`ORA-00060`)**
  - Setup: Driver throws `ORA-00060: deadlock detected while waiting for resource`.
  - Action: Collector parses error and increments `deadlocksCount`.
  - Assertions:
    - `deadlocksCount >= 1`.

- **Test 4.6: Rapid Sequential Polling Load (50 Iterations)**
  - Action: Loop 50 sequential collection runs against `MockOracleDriver`.
  - Assertions:
    - Total execution time $< 500\text{ms}$.
    - Zero memory accumulation or dangling timer handles.

---

## 5. Recommended Test Implementation Structure

Below is the concrete blueprint for `tests/unit/oracleCollector.test.ts` using Node.js built-in `node:test` and `node:assert/strict`:

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OracleCollector } from "../../src/server/collectors/oracle/OracleCollector.js";
import { MockOracleDriver } from "../../src/server/collectors/oracle/MockOracleDriver.js";
import { DBInstance } from "../../src/types/dba.js";

describe("OracleCollector Unit & Integration Test Suite", () => {
  let mockDriver: MockOracleDriver;
  let collector: OracleCollector;
  let sampleCdbInstance: DBInstance;
  let sampleStandaloneInstance: DBInstance;

  beforeEach(() => {
    mockDriver = new MockOracleDriver("HEALTHY_CDB");
    collector = new OracleCollector(mockDriver);

    sampleCdbInstance = {
      id: "ora-cdb-01",
      name: "Production CDB 19c",
      engine: "Oracle",
      version: "19.22.0.0.0",
      host: "ora-db-01.corp.internal",
      port: 1521,
      databaseName: "ORCLCDB",
      status: "ONLINE",
      uptimeSeconds: 1209600,
      cpuUsage: 25.4,
      memoryUsage: 68.2,
      iops: 1240,
      activeConnections: 45,
      maxConnections: 500,
      queryLatencyMs: 4.2,
      slowQueryCount: 2,
      diskFreeGb: 450,
      diskTotalGb: 2048,
      replicationLagSeconds: 0,
      bufferHitRatio: 98.4,
      deadlocksCount: 0,
      lastHealthCheck: new Date().toISOString(),
      engineSpecific: {},
    };

    sampleStandaloneInstance = {
      ...sampleCdbInstance,
      id: "ora-std-02",
      name: "Legacy Standalone 19c",
      databaseName: "ORCLSTD",
    };
  });

  describe("Tier 1: Metric Parsing & Mathematical Precision", () => {
    it("should accurately parse CDB multitenant topology and metadata", async () => {
      const heartbeat = await collector.collectL1Heartbeat(sampleCdbInstance);
      assert.strictEqual(heartbeat.status, "ONLINE");
      assert.strictEqual(heartbeat.isCdb, true);
      assert.strictEqual(heartbeat.databaseRole, "PRIMARY");
    });

    it("should parse SGA dynamic pools and compute buffer cache hit ratio", async () => {
      const telemetry = await collector.collectL2Telemetry(sampleCdbInstance);
      assert.ok(telemetry.sga);
      assert.strictEqual(telemetry.sga.totalMb, 32768);
      assert.strictEqual(telemetry.sga.bufferCacheMb, 20480);
      assert.strictEqual(telemetry.sga.sharedPoolMb, 8192);
      assert.strictEqual(telemetry.sga.bufferCacheHitRatio, 98.4);
    });

    it("should parse PGA aggregate stats and cache hit percentage", async () => {
      const telemetry = await collector.collectL2Telemetry(sampleCdbInstance);
      assert.ok(telemetry.pga);
      assert.strictEqual(telemetry.pga.targetMb, 16384);
      assert.strictEqual(telemetry.pga.allocatedMb, 12288);
      assert.strictEqual(telemetry.pga.cacheHitRatio, 98.4);
      assert.strictEqual(telemetry.pga.overAllocationCount, 0);
    });

    it("should parse PDB slicing and resource metrics for all containers", async () => {
      const telemetry = await collector.collectL2Telemetry(sampleCdbInstance);
      assert.ok(Array.isArray(telemetry.pdbs));
      assert.strictEqual(telemetry.pdbs.length, 3); // Seed excluded or counted
      const financePdb = telemetry.pdbs.find((p) => p.name === "PDB_FINANCE");
      assert.ok(financePdb);
      assert.strictEqual(financePdb.openMode, "READ WRITE");
      assert.strictEqual(financePdb.cpuUtilizationPct, 44.8);
    });

    it("should parse tablespace autoextend headroom and saturation percentages", async () => {
      const capacity = await collector.collectL3Capacity(sampleCdbInstance);
      assert.ok(Array.isArray(capacity.tablespaces));
      const usersTs = capacity.tablespaces.find((t) => t.tablespaceName === "USERS");
      assert.ok(usersTs);
      assert.strictEqual(usersTs.allocatedMb, 204800);
      assert.strictEqual(usersTs.usedPctOfMax, 69.3);
      assert.strictEqual(usersTs.isAutoextensible, false);
    });

    it("should parse redo log switch frequency and hourly history", async () => {
      const telemetry = await collector.collectL2Telemetry(sampleCdbInstance);
      assert.ok(telemetry.redo);
      assert.strictEqual(telemetry.redo.switchesLastHour, 4);
      assert.strictEqual(telemetry.redo.switchesLast24h, 80);
    });

    it("should parse ASM diskgroup headroom and normal redundancy", async () => {
      const capacity = await collector.collectL3Capacity(sampleCdbInstance);
      assert.ok(Array.isArray(capacity.asmDiskgroups));
      assert.strictEqual(capacity.asmDiskgroups.length, 2);
      assert.strictEqual(capacity.asmDiskgroups[0].name, "DATA");
      assert.strictEqual(capacity.asmDiskgroups[0].redundancyType, "NORMAL");
      assert.strictEqual(capacity.asmDiskgroups[0].offlineDisks, 0);
    });

    it("should parse background process status and memory usage", async () => {
      const capacity = await collector.collectL3Capacity(sampleCdbInstance);
      assert.ok(Array.isArray(capacity.backgroundProcesses));
      const pmon = capacity.backgroundProcesses.find((p) => p.name === "PMON");
      assert.ok(pmon);
      assert.strictEqual(pmon.status, "RUNNING");
      assert.strictEqual(pmon.osPid, "10412");
    });

    it("should rank top wait classes excluding idle events", async () => {
      const telemetry = await collector.collectL2Telemetry(sampleCdbInstance);
      assert.ok(Array.isArray(telemetry.topWaitClasses));
      assert.strictEqual(telemetry.topWaitClasses[0].waitClass, "System I/O");
      assert.ok(telemetry.topWaitClasses[0].pctOfTotalTime > 50);
    });

    it("should parse Data Guard formatted interval lag strings", async () => {
      const heartbeat = await collector.collectL1Heartbeat(sampleCdbInstance);
      assert.ok(heartbeat.dataGuard);
      assert.strictEqual(heartbeat.dataGuard.applyLagSeconds, 1);
      assert.strictEqual(heartbeat.dataGuard.transportLagSeconds, 0);
    });
  });

  describe("Tier 2: Boundary & Edge Case Handling", () => {
    it("should handle division by zero in buffer cache hit ratio safely", async () => {
      const customDriver = new MockOracleDriver("HEALTHY_CDB");
      // Inject zero reads and gets
      customDriver.setSysstatOverride({ physicalReads: 0, dbBlockGets: 0, consistentGets: 0 });
      const customCollector = new OracleCollector(customDriver);
      const telemetry = await customCollector.collectL2Telemetry(sampleCdbInstance);
      assert.strictEqual(telemetry.sga.bufferCacheHitRatio, 100.0);
    });

    it("should gracefully handle Non-CDB Standalone topologies", async () => {
      const standaloneDriver = new MockOracleDriver("STANDALONE_NON_CDB");
      const standaloneCollector = new OracleCollector(standaloneDriver);
      const heartbeat = await standaloneCollector.collectL1Heartbeat(sampleStandaloneInstance);
      assert.strictEqual(heartbeat.isCdb, false);
      const telemetry = await standaloneCollector.collectL2Telemetry(sampleStandaloneInstance);
      assert.deepStrictEqual(telemetry.pdbs, []);
    });

    it("should handle non-ASM databases without throwing unhandled rejection", async () => {
      const nonAsmDriver = new MockOracleDriver("NON_ASM_SYSTEM");
      const nonAsmCollector = new OracleCollector(nonAsmDriver);
      const capacity = await nonAsmCollector.collectL3Capacity(sampleCdbInstance);
      assert.strictEqual(capacity.asmEnabled, false);
      assert.deepStrictEqual(capacity.asmDiskgroups, []);
    });

    it("should detect active blocking lock chains", async () => {
      const lockDriver = new MockOracleDriver("BLOCKING_LOCKS");
      const lockCollector = new OracleCollector(lockDriver);
      const heartbeat = await lockCollector.collectL1Heartbeat(sampleCdbInstance);
      assert.ok(heartbeat.blockingLocks.length > 0);
      assert.strictEqual(heartbeat.blockingLocks[0].blockerSid, 142);
      assert.strictEqual(heartbeat.blockingLocks[0].blockedSid, 205);
    });
  });

  describe("Tier 3: Multi-Tier Cadence & Scenario Integration", () => {
    it("should only execute lightweight queries during L1 Heartbeat", async () => {
      const querySpyDriver = new MockOracleDriver("HEALTHY_CDB");
      const spyCollector = new OracleCollector(querySpyDriver);
      await spyCollector.collectL1Heartbeat(sampleCdbInstance);
      const executed = querySpyDriver.getExecutedQueries();
      assert.ok(executed.some((q) => q.includes("V$DATABASE")));
      assert.ok(!executed.some((q) => q.includes("CDB_DATA_FILES")));
      assert.ok(!executed.some((q) => q.includes("V$ASM_DISKGROUP")));
    });

    it("should accurately reflect critical tablespace saturation in TABLESPACE_FULL scenario", async () => {
      const fullDriver = new MockOracleDriver("TABLESPACE_FULL");
      const fullCollector = new OracleCollector(fullDriver);
      const capacity = await fullCollector.collectL3Capacity(sampleCdbInstance);
      const usersTs = capacity.tablespaces.find((t) => t.tablespaceName === "USERS");
      assert.ok(usersTs);
      assert.ok(usersTs.usedPctOfMax > 95.0);
      assert.ok(usersTs.totalHeadroomMb < 5000);
    });

    it("should accurately reflect Data Guard lag in DATA_GUARD_LAG scenario", async () => {
      const lagDriver = new MockOracleDriver("DATA_GUARD_LAG");
      const lagCollector = new OracleCollector(lagDriver);
      const heartbeat = await lagCollector.collectL1Heartbeat(sampleCdbInstance);
      assert.ok(heartbeat.dataGuard.applyLagSeconds > 1800); // > 30 min
    });
  });

  describe("Tier 4: Failure Handling & Load Resilience", () => {
    it("should handle ORA-12541 connection timeout cleanly without crashing", async () => {
      const timeoutDriver = new MockOracleDriver("CONNECTION_TIMEOUT");
      const timeoutCollector = new OracleCollector(timeoutDriver);
      const result = await timeoutCollector.collectL1Heartbeat(sampleCdbInstance);
      assert.strictEqual(result.status, "CRITICAL");
      assert.ok(result.error?.includes("ORA-12541"));
    });

    it("should handle ORA-01017 authentication failure with proper classification", async () => {
      const authDriver = new MockOracleDriver("AUTH_FAILURE");
      const authCollector = new OracleCollector(authDriver);
      const result = await authCollector.collectL1Heartbeat(sampleCdbInstance);
      assert.strictEqual(result.status, "CRITICAL");
      assert.ok(result.error?.includes("ORA-01017"));
    });

    it("should execute 50 sequential collection runs without memory leaks or degradation", async () => {
      const start = Date.now();
      for (let i = 0; i < 50; i++) {
        await collector.collectL1Heartbeat(sampleCdbInstance);
      }
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 1000, `Expected 50 iterations in <1000ms, took ${elapsed}ms`);
    });
  });
});
```

---

## 6. Verification Method & Test Command

To execute and verify the Oracle test suite:

```bash
# Direct test runner execution
npx tsx --test tests/unit/oracleCollector.test.ts

# Full test suite execution via npm
npm test
```

### Invalidation Conditions
The test architecture is invalidated if:
1. `MockOracleDriver` depends on any external C/C++ native binaries or external network services.
2. Query parsers throw unhandled exceptions on empty dictionary result sets.
3. Cadence tiering is violated (e.g. L1 heartbeat queries `CDB_DATA_FILES`).
4. Standalone Non-CDB instances trigger `V$PDBS` queries.
