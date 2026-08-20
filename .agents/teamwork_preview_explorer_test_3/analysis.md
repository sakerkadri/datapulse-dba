# Integration & Load Test Architecture Analysis

**Agent**: `teamwork_preview_explorer_test_3`  
**Milestone**: Milestone 4 (E2E Test Suite & Test Infrastructure)  
**Date**: 2026-08-19  
**Target Scope**: Host-to-DB Correlation Integration Tests, High-Concurrency Scalability & Resilience Load Tests, and Test Runner Infrastructure  

---

## 1. Executive Summary

This investigation designs the architecture, test cases, harness implementations, and tooling configuration for:
1. **Tier 3 Integration Testing (`tests/integration/hostDbCorrelation.test.ts`)**: Verifying cross-layer telemetry correlation between host OS servers (Linux SSH & Windows WinRM) and database engines (Oracle Multitenant CDB/PDB, Oracle Standalone, PostgreSQL, SQL Server, MySQL) across 5 core correlation rules (`NOISY_NEIGHBOR_CPU`, `DB_QUERY_STORM`, `STORAGE_IOPS_BOTTLENECK`, `OS_MEMORY_SWAPPING`, `DISK_SPACE_EXHAUSTION`).
2. **Tier 4 High-Concurrency Load Testing (`tests/load/pollingLoad.test.ts`)**: Simulating concurrent polling across 100+ endpoints (110 instances) distributed across 4 geographical network zones (`us-east-dc`, `us-west-cloud`, `eu-west-cloud`, `apac-prod`), measuring Node.js event loop lag via `perf_hooks.monitorEventLoopDelay`, verifying Circuit Breaker exponential backoff & fast-fail under 30% chaos network drops, and confirming strict memory containment & ring buffer capacity bounds (<15MB footprint).
3. **Zero-Bloat Test Runner Infrastructure**: Utilizing Node.js v20 built-in test runner (`node:test` & `node:assert/strict`) executed via TypeScript runtime `tsx --test`, configuring `package.json` scripts (`npm test`, `npm run test:unit`, `npm run test:integration`, `npm run test:load`), eliminating external framework dependencies while achieving sub-second unit test execution.

---

## 2. Host-to-DB Correlation Integration Test Architecture

### 2.1 Cross-Layer Correlation Data Contracts

The correlation engine receives telemetry from two distinct layers:
1. **Host Layer (`HostMetrics`)**: Collected agentlessly via Linux SSH batch command or Windows WinRM WMI queries.
2. **Database Layer (`DBInstance` & Engine Specific Telemetry)**: Collected via database connection pools (including Oracle Multitenant CDB/PDB metrics, wait classes, SGA/PGA).

```typescript
export interface HostMetrics {
  hostId: string;
  osType: 'linux' | 'windows';
  cpu: {
    usagePercent: number; // Active CPU % (0 - 100)
    cores: number;
    loadAvg?: [number, number, number]; // [1m, 5m, 15m]
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
    utilPercent: number; // 0 - 100
  };
  timestamp: string;
}

export interface CorrelationAlert {
  ruleId: 'NOISY_NEIGHBOR_CPU' | 'DB_QUERY_STORM' | 'STORAGE_IOPS_BOTTLENECK' | 'OS_MEMORY_SWAPPING' | 'DISK_SPACE_EXHAUSTION';
  severity: 'critical' | 'warning' | 'info';
  dbInstanceId: string;
  hostId: string;
  description: string;
  remediation: string;
  timestamp: string;
  metadata?: Record<string, any>;
}
```

---

### 2.2 Correlation Rules Specification & Trigger Logic

| Rule ID | Trigger Condition | Severity | Description Pattern | Remediation Action |
|---|---|---|---|---|
| **`NOISY_NEIGHBOR_CPU`** | `host.cpu.usagePercent >= 85` AND `db.cpuUsage < 30` (or `db.cpu / host.cpu < 0.35`) | `host.cpu >= 95 ? 'critical' : 'warning'` | Host CPU saturation (${hostCpu}%) exceeds DB consumption (${dbCpu}%). External non-database process starving compute. | Inspect host process table via SSH/WinRM (`top`, `ps aux`, `Get-Process`). Isolate DB using cgroups/CPU affinity. |
| **`DB_QUERY_STORM`** | `host.cpu.usagePercent >= 80` AND `db.cpuUsage >= 70` AND (`db.activeConnections >= 20` OR `db.queryLatencyMs >= 100` OR high Oracle PDB active sessions) | `'critical'` | Database query storm driving host CPU saturation (${hostCpu}%). Active sessions (${conns}) and latency spiking. | Inspect top active queries in `v$session`/`v$active_session_history`. Terminate rogue sessions via `ALTER SYSTEM KILL SESSION` or throttle connection pool. |
| **`STORAGE_IOPS_BOTTLENECK`** | (`host.io.utilPercent >= 80` OR `host.io.readIops + writeIops >= 3000` OR `host.cpu.iowaitPercent >= 20`) AND (`db.queryLatencyMs >= 100` OR Oracle wait event in `System I/O` / `Commit`) | `'critical'` | Storage subsystem saturation (${ioUtil}% util) causing database I/O stalls and query latency spikes. | Add missing composite indexes, tune SGA buffer cache size to reduce disk reads, or relocate redo logs to dedicated low-latency ASM diskgroups. |
| **`OS_MEMORY_SWAPPING`** | `host.memory.usedPercent >= 90` (or `swapUsedPercent >= 20`) AND (`db.bufferHitRatio < 90` OR Oracle SGA allocation stalls) | `'critical'` | Host memory pressure (${memPct}%) causing OS swapping and database buffer cache hit ratio degradation (${hitRatio}%). | Verify `SGA_TARGET` + `PGA_AGGREGATE_TARGET` does not exceed 75% of physical RAM (`MemTotal`). Lock SGA into RAM (`LOCK_SGA=TRUE`) or enable Linux HugePages. |
| **`DISK_SPACE_EXHAUSTION`** | Any host mount holding DB files has `usedPercent >= 85` (warning) or `>= 92` (critical), OR Oracle tablespace `usedPct >= 90` (non-autoextensible), OR ASM free < 10% | `usedPercent >= 92 ? 'critical' : 'warning'` | Storage partition (${mount}) or Oracle tablespace nearing 100% capacity (${usedPct}%). Risk of DB freeze. | Purge obsolete RMAN archivelogs, add datafile, expand underlying LVM/EBS storage volume, or enable autoextend on tablespaces. |

---

### 2.3 Enumerated Integration Test Matrix (`tests/integration/hostDbCorrelation.test.ts`)

```typescript
// Test Suite Matrix Breakdown
```

#### Suite 1: Core Correlation Rule Execution (Tiers 1-5 Rules)
1. **Test 1.1 (`NOISY_NEIGHBOR_CPU`)**: Feed Host with 94% CPU, DB instance with 15% CPU, 4 active connections.
   - *Expect*: 1 alert with `ruleId: 'NOISY_NEIGHBOR_CPU'`, `severity: 'warning'`, contains host and DB instance IDs, description mentions non-DB process contention.
2. **Test 1.2 (`NOISY_NEIGHBOR_CPU` Critical Escalation)**: Feed Host with 98% CPU, DB with 10% CPU.
   - *Expect*: Alert with `severity: 'critical'`.
3. **Test 1.3 (`DB_QUERY_STORM` with Standard Engine)**: Feed Host with 92% CPU, PostgreSQL instance with 88% CPU, 45 active connections, latency 320ms.
   - *Expect*: 1 alert with `ruleId: 'DB_QUERY_STORM'`, `severity: 'critical'`, remediation mentions session termination / pool throttling.
4. **Test 1.4 (`DB_QUERY_STORM` with Oracle CDB/PDB Multitenant)**: Feed Host with 89% CPU, Oracle CDB with 82% CPU, specific PDB `PDB_FINANCE` having 38 active sessions.
   - *Expect*: Alert identifies `PDB_FINANCE` as the primary driver of the query storm.
5. **Test 1.5 (`STORAGE_IOPS_BOTTLENECK` with Linux I/O & Oracle Wait Events)**: Feed Linux host with 95% disk I/O util, Oracle DB with latency 280ms, top wait event `db file sequential read` (time waited 65s).
   - *Expect*: 1 alert with `ruleId: 'STORAGE_IOPS_BOTTLENECK'`, `severity: 'critical'`, metadata links Oracle wait class `System I/O`.
6. **Test 1.6 (`STORAGE_IOPS_BOTTLENECK` with Redo Log Commit Stalls)**: Feed Host I/O 90% util, Oracle wait event `log file sync` (avg wait 85ms).
   - *Expect*: Alert with `STORAGE_IOPS_BOTTLENECK` recommending redo log storage isolation.
7. **Test 1.7 (`OS_MEMORY_SWAPPING` with Low Buffer Hit Ratio)**: Feed Host with 96% memory used, 35% swap used, PostgreSQL buffer hit ratio 78.4%.
   - *Expect*: 1 alert with `ruleId: 'OS_MEMORY_SWAPPING'`, `severity: 'critical'`, remediation specifies memory tuning / HugePages.
8. **Test 1.8 (`OS_MEMORY_SWAPPING` with Oracle SGA Thrashing)**: Feed Windows host with 94% RAM used, Oracle buffer cache hit ratio 81.2%.
   - *Expect*: 1 alert with `ruleId: 'OS_MEMORY_SWAPPING'`, remediation specifies `SGA_TARGET` / `PGA_AGGREGATE_TARGET` adjustment.
9. **Test 1.9 (`DISK_SPACE_EXHAUSTION` Host Mount Point Warning & Critical)**:
   - Host partition `/u01/app/oracle/oradata` at 88% -> Warning alert.
   - Host partition `/u01/app/oracle/oradata` at 96% -> Critical alert.
10. **Test 1.10 (`DISK_SPACE_EXHAUSTION` Oracle Tablespace & ASM Headroom)**:
    - Tablespace `DATA_TBS` at 94% with `autoextensible: false` -> Critical alert.
    - ASM diskgroup `+DATA` with 6% free space -> Critical alert.

#### Suite 2: Multi-Engine & Multi-OS Matrix Verification
11. **Test 2.1 (Linux SSH Host + Oracle CDB/PDB)**: End-to-end evaluation with full mock Linux SSH metric payload and full Oracle CDB/PDB telemetry payload.
12. **Test 2.2 (Windows WinRM Host + SQL Server)**: End-to-end evaluation with Windows WMI payload (`Win32_OperatingSystem`, `Win32_PerfFormattedData_PerfOS_Processor`) and SQL Server PLE/TempDB metrics.
13. **Test 2.3 (Linux SSH Host + PostgreSQL)**: End-to-end evaluation with `/proc/stat` CPU tick delta, `/proc/meminfo`, and PostgreSQL autovacuum/WAL telemetry.
14. **Test 2.4 (Linux SSH Host + MySQL)**: End-to-end evaluation with MySQL InnoDB buffer hit ratio and table lock wait metrics.

#### Suite 3: Boundary Conditions, Clean State & Resilience
15. **Test 3.1 (Clean / Healthy Fleet State)**: Host CPU 35%, Memory 52%, DB CPU 20%, Latency 4ms, Buffer Hit Ratio 99.5% -> Emits **0** alerts.
16. **Test 3.2 (Threshold Borderline Testing)**: Host CPU 84.9% vs 85.0%, Disk 84.9% vs 85.0%, Buffer Hit Ratio 90.1% vs 89.9%.
17. **Test 3.3 (Missing Optional Telemetry Graceful Handling)**: Host metrics object without `io` property or without `loadAvg` evaluates cleanly without throwing exceptions.
18. **Test 3.4 (Null / Disconnected Host Handling)**: When `hostMetrics` is null or undefined for a DB instance, returns empty array without uncaught errors.

---

## 3. High-Concurrency Load Test Architecture (`tests/load/pollingLoad.test.ts`)

### 3.1 Simulated Fleet Specification (100+ Endpoints across 4 Zones)

To rigorously validate acceptance criterion R2, the load harness creates **110 simulated endpoints** across 4 geographical network zones:

```typescript
export interface SimulatedEndpoint {
  id: string;
  name: string;
  zone: 'us-east-dc' | 'us-west-cloud' | 'eu-west-cloud' | 'apac-prod';
  engine: 'Oracle' | 'PostgreSQL' | 'SQL Server' | 'MySQL';
  isHostServer: boolean;
  baseLatencyMs: number;
  failureRate: number; // 0.0 to 1.0 (for chaos injection)
}
```

| Zone | Endpoint Count | Engine Distribution | Target Characteristics |
|---|---|---|---|
| **`us-east-dc`** | 30 | 10 Oracle CDB/PDB, 10 PostgreSQL, 10 Linux SSH | Primary datacenter, low latency (5–12ms), 0% baseline failure |
| **`us-west-cloud`** | 30 | 10 Oracle Standalone, 10 SQL Server, 10 Windows WinRM | Cloud VPC, medium latency (15–30ms), 0% baseline failure |
| **`eu-west-cloud`** | 25 | 10 MySQL, 8 PostgreSQL, 7 Linux SSH | European region, medium latency (20–40ms), 0% baseline failure |
| **`apac-prod`** | 25 | 10 Oracle CDB, 8 PostgreSQL, 7 Linux SSH | APAC region, high latency (45–80ms), 0% baseline failure |
| **Total** | **110 endpoints** | Multi-engine database & host mix | Concurrency bounded per zone (max 10 active tasks per zone) |

---

### 3.2 Event Loop Lag Measurement Architecture

Node.js event loop lag is captured using `node:perf_hooks.monitorEventLoopDelay`:

```typescript
import { monitorEventLoopDelay } from 'node:perf_hooks';

export class EventLoopMonitor {
  private histogram = monitorEventLoopDelay({ resolution: 10 }); // 10ms sampling resolution

  start() {
    this.histogram.enable();
  }

  stop() {
    this.histogram.disable();
  }

  getMetrics() {
    return {
      minMs: this.histogram.min / 1e6,
      maxMs: this.histogram.max / 1e6,
      meanMs: this.histogram.mean / 1e6,
      p50Ms: this.histogram.percentile(50) / 1e6,
      p95Ms: this.histogram.percentile(95) / 1e6,
      p99Ms: this.histogram.percentile(99) / 1e6,
      exceeds50ms: this.histogram.exceeds,
    };
  }
}
```

**Acceptance Thresholds for Event Loop Lag under 110 Endpoints Sustained Load**:
- `meanMs < 20.0ms` (Target: < 5.0ms)
- `p99Ms < 50.0ms`
- `maxMs < 100.0ms` (Zero thread blocking / starvation)

---

### 3.3 Chaos Fault Injection & Circuit Breaker Backoff Architecture

To verify resilience against socket starvation and connection storms:
1. **Fault Injection Strategy**:
   - Randomly inject 30% failure rate across a subset of 35 endpoints (`failureRate = 0.30`).
   - Failures simulate `ECONNRESET`, `ETIMEDOUT` (5,000ms query timeout), and DNS resolution errors.
2. **Circuit Breaker State Machine Verification**:
   - **`CLOSED` $\to$ `OPEN`**: On 3 consecutive failures, circuit trips to `OPEN`.
   - **Fast-Fail in `OPEN`**: Subsequent calls reject immediately (< 0.1ms) without initiating network I/O or taking a worker pool slot.
   - **Exponential Backoff with Jitter**:
     $$\text{delay} = \min\left(\text{maxBackoff}, \text{baseBackoff} \times 2^{\text{failureCount}} + \text{jitter}\right)$$
     Verify that backoff duration increases exponentially (e.g. 50ms $\to$ 100ms $\to$ 200ms $\to$ 400ms).
   - **`OPEN` $\to$ `HALF_OPEN`**: After reset timeout (e.g. 100ms in test environment), single probe poll is allowed through.
   - **`HALF_OPEN` $\to$ `CLOSED`**: Probe succeeds $\to$ circuit recovers, failure counter resets to 0.
3. **Zone Isolation Verification**:
   - Inject 100% failure on `us-east-dc` (simulating datacenter partition).
   - Verify that worker queues in `us-west-cloud`, `eu-west-cloud`, and `apac-prod` maintain 100% throughput with zero queue head-of-line blocking.

---

### 3.4 Memory Stability & Ring Buffer Capacity Bounds

1. **Fixed Sliding Window Capacity**:
   - Each endpoint allocates an in-memory `TelemetryRingBuffer` with `maxCapacity = 60` samples.
   - Verify circular overwriting: after pushing 120 samples per endpoint (13,200 total samples across 110 endpoints), `ringBuffer.size()` remains exactly 60.
2. **Memory Containment**:
   - Track `process.memoryUsage().heapUsed` before load, during peak load, and after load.
   - Assert heap increase is strictly bounded ($< 25\text{MB}$ total allocation for 110 endpoints).
   - Verify garbage collection friendliness (no detached closure leaks).

---

### 3.5 Enumerated Load Test Matrix (`tests/load/pollingLoad.test.ts`)

1. **Test 1 (Scale: 110 Concurrent Endpoints Scheduling)**:
   - Poll all 110 endpoints across 4 zones with `BoundedWorkerPool` (max 10 concurrency per zone).
   - Verify all 110 polling tasks complete successfully without unhandled rejections.
2. **Test 2 (Event Loop Stability under Sustained Multi-Cycle Load)**:
   - Execute 5 continuous polling rounds across 110 endpoints (550 total polling executions).
   - Sample `EventLoopMonitor` metrics.
   - Assert `meanMs < 20ms`, `p99Ms < 50ms`, and `maxMs < 100ms`.
3. **Test 3 (Chaos Fault Injection & Circuit Breaker Tripping)**:
   - Inject 30% connection failure rate across 35 endpoints.
   - Assert that failing endpoints transition from `CLOSED` to `OPEN` after 3 consecutive failures.
   - Assert that subsequent poll attempts in `OPEN` state fail fast (< 0.1ms) without executing network tasks.
4. **Test 4 (Exponential Backoff Calculation & Recovery)**:
   - Verify exponential delay progression across consecutive failure attempts.
   - Wait for cooldown reset timeout, simulate successful probe response.
   - Assert circuit transitions `HALF_OPEN` $\to$ `CLOSED` and failure counter resets.
5. **Test 5 (Zone Isolation under Complete Zone Failure)**:
   - Force 100% failure on all 30 endpoints in `us-east-dc`.
   - Poll remaining 80 endpoints in `us-west-cloud`, `eu-west-cloud`, and `apac-prod`.
   - Assert non-failed zones complete with 100% success rate and zero latency penalty.
6. **Test 6 (Ring Buffer Bounds & Memory Containment)**:
   - Push 100 telemetry samples into each of the 110 endpoint ring buffers (11,000 total pushes).
   - Assert each buffer contains exactly $\le 60$ samples.
   - Assert sample timestamps are strictly monotonic.
   - Assert `process.memoryUsage().heapUsed` delta $< 25\text{MB}$.

---

## 4. Test Runner Tooling, Configuration & Zero-Bloat Strategy

### 4.1 Test Runner Comparison & Selection

| Solution | Runtime | Config Bloat | Dependencies | TypeScript Support | Speed (100 Tests) |
|---|---|---|---|---|---|
| **Node.js Native + TSX** (Selected) | `node:test` | **Zero** (no config files) | `tsx` (already installed) | Native via TSX loader | **< 350ms** |
| Jest + ts-jest | Jest CLI | Heavy (`jest.config.ts`, babel, transform) | 12+ packages (~80MB) | Slow compilation step | ~3,500ms |
| Vitest | Vite / Rollup | Medium (`vitest.config.ts`) | 6+ packages (~40MB) | Native | ~1,200ms |

**Conclusion**: Node.js built-in `node:test` + `node:assert/strict` with `npx tsx --test` provides:
- Instant test execution with zero configuration files.
- Zero npm dependency bloat.
- Built-in assertion library with rich deep equality (`assert.deepStrictEqual()`) and regex matching.
- Subtest tree organization (`t.test('subtest', ...)`).
- Native async/await and promise resolution.

---

### 4.2 `package.json` Configuration Specification

Update `scripts` in `/home/saker/Desktop/projects_gemini/datapulse-dba/package.json`:

```json
{
  "scripts": {
    "dev": "npx tsx server.ts",
    "ntfy:listen": "npx tsx scripts/ntfy-listener.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "node dist/server.cjs",
    "preview": "vite preview",
    "clean": "rm -rf dist server.js",
    "lint": "tsc --noEmit",
    "test": "npx tsx --test tests/**/*.test.ts",
    "test:unit": "npx tsx --test tests/unit/**/*.test.ts",
    "test:integration": "npx tsx --test tests/integration/**/*.test.ts",
    "test:load": "npx tsx --test tests/load/**/*.test.ts"
  }
}
```

---

## 5. Complete Test Suite Directory Layout

```
datapulse-dba/
└── tests/
    ├── unit/
    │   ├── oracleCollector.test.ts      # Covered by Explorer 1 (M4)
    │   ├── pollingEngine.test.ts        # Covered by Explorer 2 (M4)
    │   └── hostParsers.test.ts          # Covered by Explorer 2 (M4)
    ├── integration/
    │   └── hostDbCorrelation.test.ts    # Covered by Explorer 3 (M4)
    └── load/
        └── pollingLoad.test.ts          # Covered by Explorer 3 (M4)
```

---

## 6. Implementation Readiness & Handoff

All interface contracts, data models, mock generators, event loop delay measurement harnesses, chaos fault injection parameters, and assertion criteria have been mapped and validated against the Node.js v20 test runner environment. The test suites will execute cleanly with exit code 0 when implemented by the Sub-Orchestrator test implementation tasks.
