# Technical Analysis & Unit Test Architecture: Polling Engine & Host Metric Parsers (Milestone 4)

**Author:** teamwork_preview_explorer_test_2  
**Date:** 2026-08-19  
**Target Test Suites:**
- `tests/unit/pollingEngine.test.ts` (BoundedWorkerPool, EndpointCircuitBreaker, TelemetryRingBuffer, TieredScheduler)
- `tests/unit/hostParsers.test.ts` (Linux /proc/stat tick delta, /proc/meminfo, /proc/loadavg, df, diskstats, Windows WinRM/WMI)

---

## 1. Executive Summary

This document specifies the technical design, interface contracts, mathematical formulas, and exhaustive test cases for **Milestone 4: E2E Test Suite & Test Infrastructure**, specifically focusing on:
1. **Polling Engine Core**: Concurrency bounding, priority task queues, 3-tiered cadence scheduling, circuit breaker state machine with exponential backoff & randomized full jitter, and fixed-capacity sliding window ring buffers.
2. **Host Metric Parsers**: Linux atomic batch command output parser (`/proc/stat` tick delta, `/proc/meminfo`, `/proc/loadavg`, `df -Pk`, `/proc/diskstats`) and Windows WMI/WinRM parser (`Win32_PerfFormattedData_PerfOS_Processor`, `Win32_OperatingSystem`, `Win32_LogicalDisk`).

All test cases are designed for the **Node.js native test runner** (`node:test` and `node:assert/strict`), executable without external framework bloat via `npx tsx --test`.

---

## 2. System Under Test (SUT) Interface Contracts

### 2.1 Polling Engine Contracts (`src/server/polling/` or `src/engine/`)

#### 1. BoundedWorkerPool
```typescript
export interface QueuedTask<T> {
  id: string;
  priority: number; // 3 = L1 Heartbeat, 2 = L2 Telemetry, 1 = L3 Deep Diagnostics
  endpointId: string;
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  createdAt: number;
}

export class BoundedWorkerPool {
  constructor(
    public readonly zone: string,
    public readonly maxConcurrency: number = 10,
    public readonly maxQueueSize: number = 500
  );
  run<T>(endpointId: string, task: () => Promise<T>, priority?: number): Promise<T>;
  get stats(): { zone: string; activeWorkers: number; queuedTasks: number; maxConcurrency: number };
}
```

#### 2. EndpointCircuitBreaker
```typescript
export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerConfig {
  failureThreshold: number;      // default: 3
  baseResetTimeoutMs: number;    // default: 10,000 ms
  maxResetTimeoutMs: number;     // default: 300,000 ms (5 min)
  jitterFactor: number;          // default: 0.25 (±25%)
  executionTimeoutMs: number;    // default: 5,000 ms
}

export class EndpointCircuitBreaker {
  constructor(
    public readonly endpointId: string,
    config?: Partial<CircuitBreakerConfig>
  );
  getState(): CircuitState;
  execute<T>(action: () => Promise<T>, fallback: (reason: string) => T): Promise<T>;
  get status(): {
    endpointId: string;
    state: CircuitState;
    consecutiveFailures: number;
    consecutiveTrips: number;
    nextAttemptTimestamp: number;
  };
}
```

#### 3. TelemetryRingBuffer
```typescript
export class TelemetryRingBuffer<T> {
  constructor(public readonly capacity: number = 60);
  push(item: T): void;
  toArray(): T[];
  get latest(): T | null;
  clear(): void;
  get size(): number;
}
```

#### 4. TieredScheduler
```typescript
export type CadenceTier = "L1_HEARTBEAT" | "L2_TELEMETRY" | "L3_DEEP_DIAGNOSTICS";

export interface TierCadenceConfig {
  l1IntervalMs: number; // default: 5,000 ms
  l2IntervalMs: number; // default: 30,000 ms
  l3IntervalMs: number; // default: 300,000 ms (5 min)
}

export class TieredScheduler {
  constructor(config?: Partial<TierCadenceConfig>);
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  registerEndpoint(endpoint: { id: string; zone: string; [key: string]: any }): void;
  unregisterEndpoint(endpointId: string): void;
  pollOnDemand(endpointId: string, tier: CadenceTier): Promise<any>;
  updateAdaptiveCadence(endpointId: string, cpuUsagePct: number): void;
}
```

---

### 2.2 Host Metric Parser Contracts (`src/server/host/` or `src/collectors/os/`)

#### 1. LinuxHostMetricParser
```typescript
export interface LinuxProcSample {
  cpuUser: number;
  cpuNice: number;
  cpuSystem: number;
  cpuIdle: number;
  cpuIowait: number;
  cpuIrq: number;
  cpuSoftirq: number;
  cpuSteal: number;
  totalActive: number;
  totalTime: number;
}

export interface HostDiskMount {
  filesystem: string;
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usedPercent: number;
  mountPoint: string;
}

export interface ParsedHostMetrics {
  hostId: string;
  timestamp: string;
  osType: "LINUX" | "WINDOWS";
  cpuUsagePct: number;
  cpuBreakdown: {
    userPct: number;
    systemPct: number;
    iowaitPct: number;
    stealPct: number;
  };
  memory: {
    totalGb: number;
    usedGb: number;
    availableGb: number;
    usedPercent: number;
    swapTotalGb: number;
    swapUsedGb: number;
    swapUsedPercent: number;
  };
  disks: HostDiskMount[];
  loadAverage: {
    load1m: number;
    load5m: number;
    load15m: number;
  };
  uptimeSeconds: number;
  iopsTotal: number;
}

export class LinuxHostMetricParser {
  parseBatchOutput(hostId: string, rawOutput: string): ParsedHostMetrics;
}
```

#### 2. WindowsWmiMetricParser
```typescript
export class WindowsWmiMetricParser {
  parseWmiPayload(
    hostId: string,
    payload: {
      cpu?: { PercentProcessorTime?: number; LoadPercentage?: number };
      os?: {
        TotalVisibleMemorySize?: number;
        FreePhysicalMemory?: number;
        TotalVirtualMemorySize?: number;
        FreeVirtualMemory?: number;
        LastBootUpTime?: string;
      };
      disks?: Array<{
        DeviceID: string;
        VolumeName?: string;
        Size?: number;
        FreeSpace?: number;
        FileSystem?: string;
        DriveType?: number;
      }>;
      diskPerf?: { DiskTransfersPerSec?: number };
    }
  ): ParsedHostMetrics;
}
```

---

## 3. Unit Test Suite 1: `tests/unit/pollingEngine.test.ts`

### 3.1 BoundedWorkerPool Test Cases

| # | Test Name | Tier | Description & Verification |
|---|---|---|---|
| 1 | `concurrency limit enforcement` | Tier 1 | With `maxConcurrency = 3` and 10 async tasks taking 50ms each, assert `activeWorkers <= 3` throughout execution and all 10 resolve. |
| 2 | `priority queue ordering` | Tier 1 | When pool is saturated, queue tasks with Priority 1 (L3), Priority 2 (L2), and Priority 3 (L1). Assert Priority 3 completes before Priority 2, which completes before Priority 1. |
| 3 | `fifo ordering within same priority` | Tier 1 | Queue 4 tasks with Priority 2. Assert they execute in strict creation timestamp order. |
| 4 | `task resolution and value return` | Tier 1 | Assert `run()` returns the exact resolved value from the asynchronous task closure. |
| 5 | `error propagation and worker release` | Tier 1 | When a task throws or rejects, assert the promise rejection is returned to caller and `activeWorkers` decrements back to 0 without wedging pool. |
| 6 | `queue overflow rejection` | Tier 2 | Set `maxConcurrency = 1, maxQueueSize = 2`. Submit 1 active + 2 queued + 1 extra task. Assert 4th task immediately rejects with `Queue overflow`. |
| 7 | `single concurrency serialization` | Tier 2 | Set `maxConcurrency = 1`. Assert 5 tasks execute strictly sequentially with 0 concurrency overlap. |
| 8 | `high-volume burst stress` | Tier 2 | Submit 50 fast asynchronous tasks simultaneously. Assert all 50 resolve with zero unhandled rejections and final activeWorkers = 0. |
| 9 | `stats telemetry accuracy` | Tier 2 | Query `pool.stats` at idle, peak load, and post-drain. Assert `activeWorkers` and `queuedTasks` accurately match internal state. |
| 10 | `empty queue drain idempotence` | Tier 2 | Drain an idle pool; assert no exceptions are thrown and pool remains healthy. |

#### Representative Test Code:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BoundedWorkerPool } from "../../src/server/polling/BoundedWorkerPool.js";

describe("BoundedWorkerPool", () => {
  it("should bound concurrency to maxConcurrency limit", async () => {
    const pool = new BoundedWorkerPool("us-east-1", 3, 50);
    let currentConcurrent = 0;
    let maxObservedConcurrent = 0;

    const tasks = Array.from({ length: 10 }, (_, i) =>
      pool.run(`endpoint-${i}`, async () => {
        currentConcurrent++;
        maxObservedConcurrent = Math.max(maxObservedConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 20));
        currentConcurrent--;
        return `result-${i}`;
      })
    );

    const results = await Promise.all(tasks);
    assert.equal(results.length, 10);
    assert.ok(maxObservedConcurrent <= 3, `Observed concurrency ${maxObservedConcurrent} exceeded 3`);
    assert.equal(pool.stats.activeWorkers, 0);
    assert.equal(pool.stats.queuedTasks, 0);
  });

  it("should prioritize L1 Heartbeat (p3) over L3 Deep (p1) tasks", async () => {
    const pool = new BoundedWorkerPool("eu-west-1", 1, 50);
    const executionOrder: string[] = [];

    // Saturate pool with blocker
    const blocker = pool.run("blocker", () => new Promise((r) => setTimeout(r, 30)));

    // Queue L3 (Priority 1) first
    const p1Task = pool.run("l3-deep", async () => {
      executionOrder.push("L3_DEEP");
    }, 1);

    // Queue L1 (Priority 3) second
    const p3Task = pool.run("l1-heartbeat", async () => {
      executionOrder.push("L1_HEARTBEAT");
    }, 3);

    // Queue L2 (Priority 2) third
    const p2Task = pool.run("l2-telemetry", async () => {
      executionOrder.push("L2_TELEMETRY");
    }, 2);

    await Promise.all([blocker, p1Task, p3Task, p2Task]);
    assert.deepEqual(executionOrder, ["L1_HEARTBEAT", "L2_TELEMETRY", "L3_DEEP"]);
  });

  it("should reject tasks when queue exceeds maxQueueSize", async () => {
    const pool = new BoundedWorkerPool("apac-1", 1, 2);
    const blocker = pool.run("b", () => new Promise((r) => setTimeout(r, 50)));
    const q1 = pool.run("q1", () => Promise.resolve());
    const q2 = pool.run("q2", () => Promise.resolve());

    await assert.rejects(
      pool.run("q3_overflow", () => Promise.resolve()),
      /Queue overflow/
    );

    await Promise.all([blocker, q1, q2]);
  });
});
```

---

### 3.2 EndpointCircuitBreaker Test Cases

| # | Test Name | Tier | Description & Verification |
|---|---|---|---|
| 1 | `initial state CLOSED` | Tier 1 | Assert new breaker starts in `CircuitState.CLOSED`, `consecutiveFailures = 0`, `consecutiveTrips = 0`. |
| 2 | `successful execution in CLOSED` | Tier 1 | Action resolves normally; assert breaker stays `CLOSED` and failure counter is 0. |
| 3 | `transition CLOSED to OPEN on failure threshold` | Tier 1 | Inject 3 consecutive errors (with threshold = 3). Assert breaker state changes to `CircuitState.OPEN`. |
| 4 | `fast-fail in OPEN state without network I/O` | Tier 1 | When `OPEN`, call `execute()`. Assert action function is NOT invoked and fallback response is returned in $<1\,\text{ms}$. |
| 5 | `transition OPEN to HALF_OPEN after reset timeout` | Tier 1 | Mock/advance time beyond `nextAttemptTimestamp`. Assert `getState()` returns `CircuitState.HALF_OPEN`. |
| 6 | `HALF_OPEN successful probe recovery to CLOSED` | Tier 1 | In `HALF_OPEN`, probe succeeds. Assert state transitions to `CLOSED`, resetting `consecutiveTrips = 0` and `consecutiveFailures = 0`. |
| 7 | `HALF_OPEN failed probe reversion to OPEN` | Tier 1 | In `HALF_OPEN`, probe fails. Assert state reverts to `OPEN`, `consecutiveTrips` increments to 2, and backoff increases. |
| 8 | `intermediate success resets failure count` | Tier 2 | Fail 2 times, succeed 1 time, fail 1 time. Assert breaker remains `CLOSED` (did not trip on 3rd total failure). |
| 9 | `HALF_OPEN single in-flight probe guard` | Tier 2 | In `HALF_OPEN`, start a probe taking 50ms. A second concurrent call while probe is in-flight must receive fallback (`Probe already in flight`) without spawning second action. |
| 10 | `exponential backoff cooldown growth` | Tier 2 | Trip breaker multiple times. Assert raw backoff doubles: $10\text{s} \to 20\text{s} \to 40\text{s} \to 80\text{s}$ up to `maxResetTimeoutMs` (300s). |
| 11 | `jitter bounds validation` | Tier 2 | Measure 100 trips with jitter factor = 0.25. Assert all calculated cooldowns fall within $[0.75 \times T_{\text{backoff}}, 1.25 \times T_{\text{backoff}}]$. |
| 12 | `execution timeout triggers failure` | Tier 2 | Pass action that exceeds `executionTimeoutMs` (e.g. 50ms). Assert timeout rejection occurs and increments `consecutiveFailures`. |

#### Representative Test Code:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EndpointCircuitBreaker, CircuitState } from "../../src/server/polling/CircuitBreaker.js";

describe("EndpointCircuitBreaker", () => {
  it("should trip from CLOSED to OPEN after 3 consecutive failures", async () => {
    const cb = new EndpointCircuitBreaker("db-target-1", {
      failureThreshold: 3,
      baseResetTimeoutMs: 1000,
      jitterFactor: 0,
    });

    assert.equal(cb.getState(), CircuitState.CLOSED);

    // Failure 1
    await cb.execute(() => Promise.reject(new Error("Err1")), (msg) => msg);
    assert.equal(cb.getState(), CircuitState.CLOSED);

    // Failure 2
    await cb.execute(() => Promise.reject(new Error("Err2")), (msg) => msg);
    assert.equal(cb.getState(), CircuitState.CLOSED);

    // Failure 3 -> Trips to OPEN
    await cb.execute(() => Promise.reject(new Error("Err3")), (msg) => msg);
    assert.equal(cb.getState(), CircuitState.OPEN);
    assert.equal(cb.status.consecutiveTrips, 1);
  });

  it("should fast-fail in OPEN state without calling action", async () => {
    const cb = new EndpointCircuitBreaker("db-target-2", {
      failureThreshold: 1,
      baseResetTimeoutMs: 5000,
      jitterFactor: 0,
    });

    await cb.execute(() => Promise.reject(new Error("Down")), (msg) => msg);
    assert.equal(cb.getState(), CircuitState.OPEN);

    let actionCalled = false;
    const res = await cb.execute(
      async () => {
        actionCalled = true;
        return "live";
      },
      (reason) => `fallback: ${reason}`
    );

    assert.equal(actionCalled, false);
    assert.ok(res.includes("Circuit is OPEN. Fast-failing"));
  });

  it("should transition HALF_OPEN -> CLOSED on successful probe", async () => {
    const cb = new EndpointCircuitBreaker("db-target-3", {
      failureThreshold: 1,
      baseResetTimeoutMs: 20,
      jitterFactor: 0,
    });

    await cb.execute(() => Promise.reject(new Error("Fail")), (msg) => msg);
    assert.equal(cb.getState(), CircuitState.OPEN);

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(cb.getState(), CircuitState.HALF_OPEN);

    // Probe success
    const result = await cb.execute(() => Promise.resolve("recovered"), (msg) => msg);
    assert.equal(result, "recovered");
    assert.equal(cb.getState(), CircuitState.CLOSED);
    assert.equal(cb.status.consecutiveFailures, 0);
    assert.equal(cb.status.consecutiveTrips, 0);
  });
});
```

---

### 3.3 TelemetryRingBuffer Test Cases

| # | Test Name | Tier | Description & Verification |
|---|---|---|---|
| 1 | `initial state empty` | Tier 1 | Assert new buffer with capacity = 60 has `size = 0`, `latest = null`, and `toArray() = []`. |
| 2 | `sequential push within capacity` | Tier 1 | Push 5 metric points. Assert `size = 5`, `latest` matches 5th item, and `toArray()` returns 5 items in order. |
| 3 | `overrun eviction of oldest samples` | Tier 1 | Create buffer with capacity = 5. Push items 1 through 8. Assert `size = 5`, oldest 3 items (1, 2, 3) are evicted, and `toArray()` returns `[4, 5, 6, 7, 8]`. |
| 4 | `latest property accuracy across wraps` | Tier 1 | Push 100 items into buffer of capacity 10. Assert `latest` always equals the exact last inserted item. |
| 5 | `clear resets pointers and count` | Tier 1 | Push 10 items, invoke `clear()`. Assert `size = 0`, `latest = null`, `toArray() = []`. |
| 6 | `capacity of one boundary` | Tier 2 | Capacity = 1. Push 3 items sequentially. Assert buffer always contains only the most recent item and size = 1. |
| 7 | `toArray snapshot immutability` | Tier 2 | Call `toArray()`, push or pop on the returned array. Assert internal buffer state is unmodified. |
| 8 | `memory footprint containment` | Tier 2 | Perform 10,000 pushes of structured telemetry objects. Verify internal array size stays constant at capacity (e.g. 60). |

#### Representative Test Code:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TelemetryRingBuffer } from "../../src/server/polling/TelemetryRingBuffer.js";

describe("TelemetryRingBuffer", () => {
  it("should evict oldest samples when capacity is exceeded (circular wrap)", () => {
    const buffer = new TelemetryRingBuffer<number>(3);
    buffer.push(10);
    buffer.push(20);
    buffer.push(30);
    assert.equal(buffer.size, 3);
    assert.deepEqual(buffer.toArray(), [10, 20, 30]);

    // Overrun by 2 items
    buffer.push(40);
    buffer.push(50);
    assert.equal(buffer.size, 3);
    assert.deepEqual(buffer.toArray(), [30, 40, 50]);
    assert.equal(buffer.latest, 50);
  });
});
```

---

### 3.4 TieredScheduler Test Cases

| # | Test Name | Tier | Description & Verification |
|---|---|---|---|
| 1 | `cadence intervals configuration` | Tier 1 | Verify default intervals: L1 Heartbeat = 5,000ms, L2 Telemetry = 30,000ms, L3 Deep = 300,000ms. |
| 2 | `endpoint registration and unregistration` | Tier 1 | Register endpoint -> verify timers are scheduled; unregister endpoint -> verify timers are cleaned up. |
| 3 | `on-demand poll execution` | Tier 1 | Call `pollOnDemand(endpointId, 'L1_HEARTBEAT')`. Assert task is executed immediately without waiting for timer. |
| 4 | `lifecycle start and stop` | Tier 1 | Assert `start()` begins scheduled loops and `stop()` halts all timers cleanly. |
| 5 | `adaptive cadence throttling on CPU overload` | Tier 2 | When endpoint reports `cpuUsage = 95%`, assert L3 cadence doubles (e.g. 300s -> 600s) to prevent query storms. |
| 6 | `adaptive cadence recovery` | Tier 2 | When endpoint CPU drops to 50%, assert L3 cadence resets to baseline 300s. |

---

## 4. Unit Test Suite 2: `tests/unit/hostParsers.test.ts`

### 4.1 Linux `/proc/stat` CPU Tick Delta Parser Test Cases

| # | Test Name | Tier | Description & Verification |
|---|---|---|---|
| 1 | `first tick baseline initialization` | Tier 1 | Feed initial `/proc/stat` line. Assert returns `cpuUsagePct: 0` and stores baseline sample. |
| 2 | `accurate tick delta percentage math` | Tier 1 | Feed Sample 1 (`cpu 100 0 50 850 ...`, Active 150, Total 1000) and Sample 2 (`cpu 300 0 100 1600 ...`, Active 400, Total 2000). $\Delta Active = 250, \Delta Total = 1000 \implies$ assert `cpuUsagePct = 25.0%`. |
| 3 | `cpu breakdown percentages` | Tier 1 | Assert `userPct = 20.0%`, `systemPct = 5.0%`, `iowaitPct = 0%`, `stealPct = 0%` match individual column deltas divided by $\Delta Total$. |
| 4 | `100% idle scenario` | Tier 1 | Sample 2 adds 1000 ticks solely to `idle`. Assert `cpuUsagePct = 0.0%`. |
| 5 | `100% busy saturation scenario` | Tier 1 | Sample 2 adds 1000 ticks solely to `user` + `system`. Assert `cpuUsagePct = 100.0%`. |
| 6 | `zero total delta protection` | Tier 2 | Feed identical sample twice ($\Delta Total = 0$). Assert returns `cpuUsagePct = 0.0%` without `NaN` or division-by-zero exception. |
| 7 | `counter wrap-around or reboot` | Tier 2 | Sample 2 values are lower than Sample 1 ($Total_2 < Total_1$). Assert parser resets baseline and returns `cpuUsagePct = 0.0%`. |
| 8 | `high iowait storage saturation` | Tier 2 | $\Delta iowait = 800, \Delta Total = 1000$. Assert `cpuBreakdown.iowaitPct = 80.0%`. |
| 9 | `virtualization steal time detection` | Tier 2 | $\Delta steal = 350, \Delta Total = 1000$. Assert `cpuBreakdown.stealPct = 35.0%`. |
| 10 | `multi-core aggregate filtering` | Tier 2 | Input contains `cpu  ...`, `cpu0 ...`, `cpu1 ...`. Assert parser extracts aggregate `cpu ` line and ignores per-core lines. |

#### Representative Test Code:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LinuxHostMetricParser } from "../../src/server/host/LinuxHostMetricParser.js";

describe("LinuxHostMetricParser - CPU Tick Delta", () => {
  it("should calculate exact CPU tick delta percentage between successive samples", () => {
    const parser = new LinuxHostMetricParser();

    // Sample 1: Baseline (user 100, nice 0, sys 50, idle 850) -> Active: 150, Total: 1000
    const raw1 = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
    const res1 = parser.parseBatchOutput("lnx-01", raw1);
    assert.equal(res1.cpuUsagePct, 0);

    // Sample 2: (user 300, nice 0, sys 100, idle 1600) -> Active: 400, Total: 2000
    // Delta Active = 250, Delta Total = 1000 -> 25.0%
    const raw2 = `===CPU===\ncpu  300 0 100 1600 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
    const res2 = parser.parseBatchOutput("lnx-01", raw2);
    assert.equal(res2.cpuUsagePct, 25.0);
    assert.equal(res2.cpuBreakdown.userPct, 20.0);
    assert.equal(res2.cpuBreakdown.systemPct, 5.0);
  });

  it("should handle zero delta without NaN or crash", () => {
    const parser = new LinuxHostMetricParser();
    const raw = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
    parser.parseBatchOutput("lnx-01", raw);
    const res2 = parser.parseBatchOutput("lnx-01", raw);
    assert.equal(res2.cpuUsagePct, 0);
    assert.equal(isNaN(res2.cpuUsagePct), false);
  });
});
```

---

### 4.2 Linux `/proc/meminfo` Memory Parser Test Cases

| # | Test Name | Tier | Description & Verification |
|---|---|---|---|
| 1 | `standard meminfo with MemAvailable` | Tier 1 | Input: `MemTotal: 65536000 kB` (62.5 GB), `MemFree: 4194304 kB`, `MemAvailable: 32768000 kB` (31.25 GB). Assert `totalGb = 62.5`, `availableGb = 31.25`, `usedGb = 31.25`, `usedPercent = 50.0%`. |
| 2 | `legacy fallback without MemAvailable` | Tier 1 | Input lacks `MemAvailable`. Input has `MemFree: 2097152 kB`, `Buffers: 1048576 kB`, `Cached: 5242880 kB`. Assert `availableGb` calculates `(2097152 + 1048576 + 5242880) / (1024 * 1024) = 8.0 GB`. |
| 3 | `swap space used and percentage` | Tier 1 | Input: `SwapTotal: 16777216 kB` (16 GB), `SwapFree: 12582912 kB` (12 GB). Assert `swapTotalGb = 16.0`, `swapUsedGb = 4.0`, `swapUsedPercent = 25.0%`. |
| 4 | `disabled swap (SwapTotal: 0 kB)` | Tier 1 | Input: `SwapTotal: 0 kB, SwapFree: 0 kB`. Assert `swapTotalGb = 0`, `swapUsedGb = 0`, `swapUsedPercent = 0.0%` (not `NaN`). |
| 5 | `high page cache memory model` | Tier 1 | Input: `MemTotal: 33554432 kB` (32 GB), `MemFree: 524288 kB` (512 MB), `Cached: 25165824 kB` (24 GB), `MemAvailable: 26214400 kB` (25 GB). Assert `usedPercent = 21.9%` (reflecting available memory rather than raw free). |
| 6 | `near OOM extreme memory pressure` | Tier 2 | Input: `MemTotal: 33554432 kB, MemFree: 102400 kB, MemAvailable: 204800 kB, SwapTotal: 8388608 kB, SwapFree: 838860 kB`. Assert `usedPercent = 99.4%` and `swapUsedPercent = 90.0%`. |
| 7 | `malformed meminfo whitespace tolerance` | Tier 2 | Input contains irregular spacing and extra colon tabs. Assert regex parses integers cleanly. |

---

### 4.3 Linux `/proc/loadavg`, `df -Pk`, `diskstats` & Batch Output Test Cases

| # | Test Name | Tier | Description & Verification |
|---|---|---|---|
| 1 | `loadavg 1m, 5m, 15m parsing` | Tier 1 | Input: `0.45 0.72 0.88 2/350 12345`. Assert `load1m = 0.45`, `load5m = 0.72`, `load15m = 0.88`. |
| 2 | `df -Pk standard disk mount parsing` | Tier 1 | Input: `/dev/sda1 104857600 41943040 57579520 42% /`. Assert `filesystem = /dev/sda1`, `totalGb = 100.0`, `usedGb = 40.0`, `availableGb = 54.91`, `usedPercent = 42`, `mountPoint = /`. |
| 3 | `df -Pk pseudo-filesystem filtering` | Tier 1 | Input contains `tmpfs`, `devtmpfs`, `overlay`, `squashfs`. Assert these entries are filtered out and only real storage mounts are returned. |
| 4 | `diskstats IOPS aggregation` | Tier 1 | Input contains `sda` reads 1000, writes 500, `sdb` reads 200, writes 100, `loop0` reads 50. Assert loop is ignored and total IOPS = 1800. |
| 5 | `uptime seconds extraction` | Tier 1 | Input: `123456.78 987654.32`. Assert `uptimeSeconds = 123456`. |
| 6 | `full batch script composite parsing` | Tier 2 | Feed full atomic composite script output with all 6 sections. Assert all metrics parse into `ParsedHostMetrics` in a single pass. |
| 7 | `missing or empty sections tolerance` | Tier 2 | Feed raw output with missing `===IO===` and empty `===LOAD===`. Assert parser provides graceful defaults without throwing. |

---

### 4.4 Windows WinRM / WMI Metric Parser Test Cases

| # | Test Name | Tier | Description & Verification |
|---|---|---|---|
| 1 | `cpu PercentProcessorTime formatted data` | Tier 1 | Payload: `cpu: { PercentProcessorTime: 42 }`. Assert `cpuUsagePct = 42`. |
| 2 | `cpu LoadPercentage fallback` | Tier 1 | Payload: `cpu: { LoadPercentage: 65 }` without formatted data. Assert `cpuUsagePct = 65`. |
| 3 | `physical memory KB to GB conversion` | Tier 1 | Payload: `os: { TotalVisibleMemorySize: 67108864, FreePhysicalMemory: 16777216 }`. Assert `totalGb = 64.0`, `usedGb = 48.0`, `availableGb = 16.0`, `usedPercent = 75.0%`. |
| 4 | `logical fixed disks (DriveType = 3)` | Tier 1 | Payload: `disks: [{ DeviceID: 'C:', Size: 536870912000, FreeSpace: 107374182400, DriveType: 3 }]`. Assert `mountPoint = 'C:'`, `totalGb = 500.0`, `usedGb = 400.0`, `availableGb = 100.0`, `usedPercent = 80.0%`. |
| 5 | `non-fixed disks ignored` | Tier 1 | Payload contains optical drive (`DriveType = 5`) and network share (`DriveType = 4`). Assert filtered out. |
| 6 | `WMI LastBootUpTime to uptimeSeconds` | Tier 1 | Payload: `LastBootUpTime: '20260810143000.000000+060'`. Assert parses to integer seconds $> 0$. |
| 7 | `disk transfers per second to IOPS` | Tier 1 | Payload: `diskPerf: { DiskTransfersPerSec: 1250 }`. Assert `iopsTotal = 1250`. |
| 8 | `empty or undefined payload resilience` | Tier 2 | Pass empty object `{}`. Assert returns safe zeroed metrics with `cpuUsagePct = 0`, `usedPercent = 0`, `disks = []` without throwing exceptions. |
| 9 | `malformed LastBootUpTime date fallback` | Tier 2 | Pass `LastBootUpTime: 'invalid-date'`. Assert falls back to default uptime without crashing. |

#### Representative Test Code:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WindowsWmiMetricParser } from "../../src/server/host/WindowsHostMetricParser.js";

describe("WindowsWmiMetricParser", () => {
  it("should parse CPU, physical memory, and logical disks from WMI payload", () => {
    const parser = new WindowsWmiMetricParser();
    const payload = {
      cpu: { PercentProcessorTime: 58 },
      os: {
        TotalVisibleMemorySize: 33554432, // 32 GB in KB
        FreePhysicalMemory: 8388608,      // 8 GB in KB
        LastBootUpTime: "20260815120000.000000+000",
      },
      disks: [
        {
          DeviceID: "C:",
          VolumeName: "OS",
          Size: 536870912000,       // 500 GB in Bytes
          FreeSpace: 107374182400,  // 100 GB in Bytes
          FileSystem: "NTFS",
          DriveType: 3,
        },
        {
          DeviceID: "D:",
          VolumeName: "CD-ROM",
          Size: 0,
          FreeSpace: 0,
          DriveType: 5, // Should be ignored
        },
      ],
      diskPerf: { DiskTransfersPerSec: 850 },
    };

    const res = parser.parseWmiPayload("win-host-01", payload);
    assert.equal(res.hostId, "win-host-01");
    assert.equal(res.osType, "WINDOWS");
    assert.equal(res.cpuUsagePct, 58);
    assert.equal(res.memory.totalGb, 32.0);
    assert.equal(res.memory.usedGb, 24.0);
    assert.equal(res.memory.availableGb, 8.0);
    assert.equal(res.memory.usedPercent, 75.0);
    assert.equal(res.disks.length, 1);
    assert.equal(res.disks[0].mountPoint, "C:");
    assert.equal(res.disks[0].totalGb, 500.0);
    assert.equal(res.disks[0].usedPercent, 80.0);
    assert.equal(res.iopsTotal, 850);
  });
});
```

---

## 5. Test Infrastructure & Quality Checklist

### 5.1 Test Execution Commands
- Unit test execution command:
  ```bash
  npx tsx --test tests/unit/pollingEngine.test.ts tests/unit/hostParsers.test.ts
  ```
- Full suite execution:
  ```bash
  npm test
  ```

### 5.2 Verification Criteria
1. **Zero External Test Frameworks**: Native Node.js test runner (`node:test`) and strict assertions (`node:assert/strict`).
2. **Deterministic & Isolated**: No external network calls, real SSH connections, or Windows WinRM endpoints during unit testing.
3. **Execution Speed**: Both unit test files complete in $<500\,\text{ms}$ combined.
4. **Pass Semantics**: Clean exit code 0 across all test suites.
