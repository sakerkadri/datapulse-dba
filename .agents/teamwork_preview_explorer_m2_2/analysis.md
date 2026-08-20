# Deep Technical Exploration: TieredScheduler, TelemetryRingBuffer & Central PollingEngine

**Explorer:** Explorer 2 (Milestone 2: Scalable Centralized Polling Engine)  
**Date:** 2026-08-19  
**Status:** Completed Analysis & Architecture Specification  
**Targets:** `src/server/polling/TieredScheduler.ts`, `src/server/polling/TelemetryRingBuffer.ts`, `src/server/polling/PollingEngine.ts`, `src/types/polling.ts`

---

## 1. Executive Summary

Milestone 2 delivers the **Scalable Centralized Polling Engine** for DataPulse DBA Sentinel, supporting 100+ heterogeneous database instances (Oracle, PostgreSQL, MySQL, SQL Server) and agentless host targets across multiple network zones.

This exploration establishes the complete technical architecture and algorithmic foundations for the three core coordination and caching components:
1. **`TieredScheduler`**: A 3-tiered cadence coordinator (L1 Heartbeat 5–10s, L2 Telemetry 30–60s, L3 Deep Diagnostics 5–15m) with priority dispatch, phase-offset jittered startup to eliminate thundering herds, and **dynamic adaptive load throttling** that automatically doubles L3 cadence when endpoints experience CPU or connection saturation.
2. **`TelemetryRingBuffer`**: A zero-garbage-collection, fixed-capacity circular ring buffer (default capacity 60 samples per instance) providing $O(1)$ insertions, oldest-sample eviction, memory-bounded containment (<15MB for 100+ endpoints), and rolling statistical aggregation (Min, Max, Avg, P95).
3. **`PollingEngine`**: The master coordinator unifying location-aware `BoundedWorkerPool` instances, `EndpointCircuitBreaker` resilience guards, `TieredScheduler` cadence loops, `TelemetryRingBuffer` caches, and pluggable `IEndpointCollector` modules, backed by a high-throughput `EventEmitter` for real-time Server-Sent Events (SSE) streaming.

---

## 2. Polling Engine Architecture & Data Flow

```
                      ┌─────────────────────────────────────────────────────────────┐
                      │                    CENTRAL POLLING ENGINE                   │
                      │               (Master Coordinator & Event Hub)              │
                      └──────────────────────────────┬──────────────────────────────┘
                                                     │
               ┌─────────────────────────────────────┼─────────────────────────────────────┐
               ▼                                     ▼                                     ▼
┌─────────────────────────────┐       ┌─────────────────────────────┐       ┌─────────────────────────────┐
│       TieredScheduler       │       │    Collector Registry       │       │  TelemetryRingBuffer Pool   │
│ ┌─────────────────────────┐ │       │ ┌─────────────────────────┐ │       │ ┌─────────────────────────┐ │
│ │ L1: Heartbeat (5-10s)   │ │       │ │ OracleCollector (Thin)  │ │       │ │ db-pg-01 (60 samples)   │ │
│ │ L2: Telemetry (30-60s)  │ │       │ │ PostgresCollector (SQL) │ │       │ │ db-ora-01 (60 samples)  │ │
│ │ L3: Deep Diag (5-15m)   │ │       │ │ MySQL / MSSQL Collector │ │       │ │ db-sql-01 (60 samples)  │ │
│ │ Adaptive Throttler      │ │       │ │ Linux/Win Host Collector│ │       │ │ host-01 (60 samples)    │ │
│ └─────────────────────────┘ │       │ └─────────────────────────┘ │       │ └─────────────────────────┘ │
└──────────────┬──────────────┘       └──────────────┬──────────────┘       └──────────────▲──────────────┘
               │                                     │                                     │
               │ Dispatches Tasks                    │ Executes Queries                    │ Stores Telemetry
               ▼                                     ▼                                     │
┌──────────────────────────────────────────────────────────────────────────────────────────┼──────────────┐
│ ZONE-PARTITIONED WORKER POOLS & CIRCUIT BREAKERS                                         │              │
│                                                                                          │              │
│  ZONE: us-east-1 (BoundedWorkerPool, maxConcurrency: 10)                                │              │
│  ┌─────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────┴──────────┐   │
│  │   Queued Priority Task  │ ───► │  EndpointCircuitBreaker │ ───► │ Collector Execution (L1/L2/L3) │   │
│  │   (P3: L1, P2: L2, P1:L3)│      │  (CLOSED/OPEN/HALF_OPEN)│      │ (with timeout & retry guard)   │   │
│  └─────────────────────────┘      └─────────────────────────┘      └────────────────────────────────┘   │
└───────────────────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                                    │
                                                    │ Broadcasts Events (telemetry_delta, circuit_state)
                                                    ▼
                                    ┌───────────────────────────────┐
                                    │    EventEmitter (Stream Hub)  │
                                    └───────────────┬───────────────┘
                                                    │
                           ┌────────────────────────┴────────────────────────┐
                           ▼                                                 ▼
            ┌─────────────────────────────┐                   ┌─────────────────────────────┐
            │   Express SSE Stream API    │                   │   Threshold & Incident Hub  │
            │   GET /api/stream/telemetry │                   │   Rule Evaluation Engine    │
            └─────────────────────────────┘                   └─────────────────────────────┘
```

---

## 3. Deep Dive: Component 1 — `TieredScheduler`

### 3.1 Cadence Tiers & Operational Matrix

Metric collection is divided into 3 distinct operational tiers with contrasting cadences, timeouts, and network payloads:

| Tier | Name | Default Cadence | Configurable Range | Timeout | Priority | Target Metrics | Network Overhead | SLA / Failure Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **L1** | **Heartbeat** | **5s** | 5 – 10s | 2,000ms | **3 (Highest)** | TCP connect, ping latency, basic `SELECT 1`, active session count, uptime | $< 100$ bytes | Fail fast; trip breaker on 3 failures; mark endpoint UNREACHABLE |
| **L2** | **Telemetry** | **30s** | 30 – 60s | 5,000ms | **2 (Medium)** | CPU%, Memory%, IOPS, Query Latency, Buffer Hit Ratio, Replication Lag, Active/Max Conns | $1 - 5$ KB | Push to RingBuffer, emit `telemetry_delta` SSE event, trigger alerts |
| **L3** | **Deep Diagnostics** | **5m (300s)** | 5 – 15m (300–900s) | 15,000ms | **1 (Normal)** | Tablespaces autoextend, ASM diskgroups, segment fragmentation, Top 10 wait events, deadlocks, slow query logs | $15 - 50$ KB | Cache in memory for capacity forecasting, DBA diagnostic tabs |

### 3.2 Coordination with `BoundedWorkerPool`

The scheduler does not execute network calls directly. Instead, it dispatches task wrappers to the zone-specific `BoundedWorkerPool`:
1. When an L1 tick occurs for endpoint `ep-01` in zone `us-east-1`, the scheduler calls:
   ```typescript
   workerPool.run(endpoint.id, () => this.executeTierPoll(endpoint, "L1"), 3);
   ```
2. When an L2 tick occurs:
   ```typescript
   workerPool.run(endpoint.id, () => this.executeTierPoll(endpoint, "L2"), 2);
   ```
3. When an L3 tick occurs:
   ```typescript
   workerPool.run(endpoint.id, () => this.executeTierPoll(endpoint, "L3"), 1);
   ```
4. **Preemption / Queue Ordering**: Because `BoundedWorkerPool` sorts its waiting queue by descending priority (`b.priority - a.priority || a.createdAt - b.createdAt`), L1 heartbeats immediately jump ahead of pending L3 deep diagnostic queries, ensuring critical liveness monitoring never suffers from head-of-line blocking.

### 3.3 Dynamic Adaptive Load Throttling

#### Problem
Under database saturation (e.g. CPU > 90% or connections > 90% during peak traffic), running heavy L3 queries (`v$session_wait`, `dba_tablespace_usage_metrics`, `sys.dm_os_wait_stats`, unindexed lock inspects) adds database CPU load and lock contention, creating a **query storm death spiral**.

#### Algorithm & Hysteresis
1. **Saturation Detection**:
   - Monitored on every L2 poll result for an endpoint.
   - Condition: `cpuUsage >= 90%` OR `(activeConnections / maxConnections) >= 0.90`.
2. **Throttling Action**:
   - The effective L3 interval for that specific endpoint is doubled:
     $$T_{\text{L3\_effective}} = \min(T_{\text{L3\_max}}, T_{\text{L3\_nominal}} \times 2)$$
     (e.g., $300\,\text{s} \to 600\,\text{s}$).
   - Emits event / log: `[TieredScheduler] Adaptive throttle ACTIVATED for ${endpoint.id}: L3 cadence doubled to ${effectiveL3Interval}s`.
3. **Recovery Hysteresis**:
   - To prevent rapid oscillation (flapping) between throttled and nominal cadence:
   - Recovery Condition: Endpoint must sustain `cpuUsage < 80%` AND `(activeConnections / maxConnections) < 80%` for **2 consecutive L2 ticks**.
   - Upon recovery: $T_{\text{L3\_effective}}$ resets to $T_{\text{L3\_nominal}}$.

### 3.4 Phase Offset & Jittered Startup (Anti-Thundering Herd)

When 100+ endpoints are registered simultaneously on application startup:
- If all endpoints fire L1 at $t=0, 5, 10$ and L2 at $t=0, 30, 60$, a massive CPU and network spike occurs on the host at the exact boundary of every interval.
- **Solution — Deterministic Phase Staggering**:
  Each registered endpoint is assigned a fractional initial delay offset based on its registration index or hash:
  $$\text{InitialOffset}_{\text{L1}}(i) = (i \times 250\,\text{ms}) \pmod{T_{\text{L1}}}$$
  $$\text{InitialOffset}_{\text{L2}}(i) = (i \times 1000\,\text{ms}) \pmod{T_{\text{L2}}}$$
  $$\text{InitialOffset}_{\text{L3}}(i) = (i \times 5000\,\text{ms}) \pmod{T_{\text{L3}}}$$
  This distributes poll ticks uniformly across the timeline.

### 3.5 Scheduler Lifecycle & State Machine

```
               ┌──────────────┐
               │     INIT     │
               └──────┬───────┘
                      │ start()
                      ▼
               ┌──────────────┐   pause()    ┌──────────────┐
               │   RUNNING    │ ───────────► │    PAUSED    │
               │              │ ◄─────────── │              │
               └──────┬───────┘   resume()   └──────┬───────┘
                      │                             │
                      │ stop()                      │ stop()
                      ▼                             ▼
               ┌──────────────┐              ┌──────────────┐
               │   STOPPED    │ ◄────────────┤   STOPPED    │
               └──────────────┘              └──────────────┘
```

- **`start()`**: Starts global tick timer or individual endpoint interval timers, enables task dispatching.
- **`stop()`**: Clears all timers (`clearInterval`), drains scheduled queues, sets status to `STOPPED`.
- **`pause()`**: Freezes dispatch of new tasks while preserving active timers and endpoint state.
- **`resume()`**: Re-enables task dispatching.
- **`registerEndpoint(endpoint: PollingEndpoint)`**: Staggers and attaches timers for an endpoint.
- **`unregisterEndpoint(endpointId: string)`**: Clears timers and removes endpoint from scheduling tables.
- **`onDemandPoll(endpointId: string, tier?: CadenceTier)`**: Dispatches an immediate out-of-band poll through the zone worker pool with appropriate priority, updating last poll timestamp without resetting normal cadence intervals.

---

## 4. Deep Dive: Component 2 — `TelemetryRingBuffer`

### 4.1 Circular Ring Buffer Mechanics

`TelemetryRingBuffer<T>` is an in-memory, fixed-capacity circular buffer designed for high-frequency time-series telemetry.

```
       Tail (Write Pointer) = 3
                │
                ▼
  [ 0 | 1 | 2 |   |   |   |   ] (Capacity = 7)
    ▲
    │
  Head (Read Pointer) = 0
  Count = 3
```

- **Storage**: Fixed-size internal JavaScript Array `(T | null)[]` allocated once at initialization (`new Array(capacity).fill(null)`).
- **Pointers**:
  - `head`: Index of the oldest active element.
  - `tail`: Index where the next element will be written.
  - `count`: Current number of stored elements ($0 \le \text{count} \le \text{capacity}$).
- **Push ($O(1)$)**:
  1. `buffer[tail] = item`
  2. `tail = (tail + 1) % capacity`
  3. If `count < capacity`: `count++`
  4. Else (eviction): `head = (head + 1) % capacity` (oldest element overwritten; previous reference replaced to allow immediate GC if not referenced elsewhere).
- **Serialization `toArray()` ($O(N)$)**:
  Iterates from `head` through `head + count - 1` with modulo indexing, returning an array sorted from oldest to newest timestamp.
- **Latest ($O(1)$)**:
  Returns `buffer[(tail - 1 + capacity) % capacity]`.

### 4.2 Memory Containment Analysis (<15MB Bound)

Let's compute the exact memory consumption for 100+ endpoints:
- Capacity per endpoint: $N = 60$ samples (representing 30 minutes at 30s cadence).
- JSON representation of a sample:
  ```json
  {
    "instanceId": "db-pg-01",
    "timestamp": "2026-08-19T17:00:00.000Z",
    "cpu": 42.5,
    "memory": 68.1,
    "iops": 1240,
    "activeConnections": 184,
    "maxConnections": 300,
    "queryLatencyMs": 14.2,
    "slowQueryCount": 3,
    "replicationLagSeconds": 0.2,
    "bufferHitRatio": 99.4,
    "deadlocksCount": 0
  }
  ```
- Memory per sample in V8:
  - Object header + Shape: ~48 bytes
  - Properties (12 fields $\times$ 8-byte pointer/number): ~96 bytes
  - Timestamp string: ~40 bytes
  - Total per sample: $\approx 200 - 350$ bytes.
- Total footprint for 100 database instances + 100 host nodes:
  $$200 \text{ targets} \times 60 \text{ samples} \times 350 \text{ bytes} = 4,200,000 \text{ bytes} \approx 4.2 \text{ MB}$$
- Even with V8 array overhead, closure handles, and string intern tables, total memory is **$< 8.5\text{ MB}$**, well below the $15\text{MB}$ ceiling requirement.

### 4.3 Rolling Statistics Engine

The ring buffer provides in-flight rolling statistical aggregations over the sliding window:

```typescript
export interface RollingStats {
  min: number;
  max: number;
  avg: number;
  latest: number;
  p95: number;
  count: number;
}
```

- **`getRollingStats(extractor: (sample: T) => number): RollingStats`**:
  Single-pass calculation of `min`, `max`, `sum`, `avg`, and sorted percentile approximation over the buffered samples.
- **`getMetricSummary(): RollingMetricsSummary`**:
  Pre-computes rolling stats for `cpu`, `memory`, `iops`, `latencyMs`, `activeConnections`, and `bufferHitRatio`.

---

## 5. Deep Dive: Component 3 — `PollingEngine` Coordinator

### 5.1 System Integration & Responsibilities

`PollingEngine` is the central orchestrator that links all subsystems together.

```
                           ┌────────────────────────────────────────────────────────┐
                           │                    PollingEngine                       │
                           │                                                        │
                           │  - zoneWorkerPools: Map<string, BoundedWorkerPool>     │
                           │  - circuitBreakers: Map<string, EndpointCircuitBreaker>│
                           │  - ringBuffers: Map<string, TelemetryRingBuffer>       │
                           │  - collectors: Map<DatabaseEngine, IEndpointCollector> │
                           │  - scheduler: TieredScheduler                          │
                           │  - eventEmitter: EventEmitter                          │
                           └────────────────────────────────────────────────────────┘
```

### 5.2 Pluggable Collector Registry

The engine defines a generic collector contract:

```typescript
export interface IEndpointCollector {
  collectL1(endpoint: PollingEndpoint): Promise<Partial<DBInstance>>;
  collectL2(endpoint: PollingEndpoint): Promise<Partial<DBInstance>>;
  collectL3(endpoint: PollingEndpoint): Promise<Partial<DBInstance>>;
}
```

The engine maintains a registry:
- `registerCollector(engineType: DatabaseEngine | string, collector: IEndpointCollector)`
- Supported collectors:
  - `OracleCollector` (node-oracledb Thin Mode / MockOracleDriver)
  - `PostgresCollector` (pg / mock)
  - `MySQLCollector` (mysql2 / mock)
  - `SQLServerCollector` (mssql / tedious / mock)
  - `LinuxHostCollector` (ssh2 batch runner)
  - `WindowsHostCollector` (winrm / wmi)

### 5.3 Complete Polling Execution Pipeline

When the `TieredScheduler` triggers a poll for endpoint `ep` and tier `tier`:

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Scheduler calls engine.executeScheduledPoll(endpoint, tier)                            │
│ 2. Find or create EndpointCircuitBreaker for endpoint.id                                  │
│ 3. Check Circuit State:                                                                   │
│    - If OPEN: Fast-fail (<1ms), emit circuit_state event, return cached ring buffer sample│
│    - If HALF_OPEN: Allow single probe, block concurrent probes                            │
│    - If CLOSED: Proceed                                                                   │
│ 4. Locate BoundedWorkerPool for endpoint.zone (default "default-zone")                    │
│ 5. Enqueue in WorkerPool with priority: L1 -> 3, L2 -> 2, L3 -> 1                         │
│ 6. Inside WorkerPool worker:                                                              │
│    a. Resolve registered collector for endpoint.engine                                    │
│    b. Execute breaker.execute(collector.collectL*(endpoint), fallback)                    │
│    c. If success:                                                                         │
│       - Breaker resets consecutiveFailures to 0                                           │
│       - Merge metrics into in-memory latest DBInstance state                              │
│       - If tier is L2: Push to endpoint's TelemetryRingBuffer                             │
│       - Check adaptive throttling triggers (CPU > 90% or conn > 90%)                      │
│       - Emit telemetry_delta and/or heartbeat SSE events                                  │
│       - Evaluate threshold rules -> emit incident_fired if threshold breached             │
│    d. If failure / timeout:                                                               │
│       - Breaker increments consecutiveFailures; trips to OPEN if >= threshold (3)         │
│       - Emit circuit_state update                                                         │
│       - If consecutiveFailures >= 2: Mark endpoint status as CRITICAL/UNREACHABLE         │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.4 EventEmitter Event Contracts

The engine extends `EventEmitter` and guarantees emission of strongly typed events:

| Event Name | Payload Type | Description |
| :--- | :--- | :--- |
| `telemetry_delta` | `TelemetryDeltaEvent` | Emitted when an L1/L2/L3 poll succeeds with newly sampled metrics |
| `circuit_state` | `CircuitStateEvent` | Emitted when a circuit breaker changes state (`CLOSED`, `OPEN`, `HALF_OPEN`) |
| `incident_fired` | `IncidentAlert` | Emitted when polled telemetry breaches configured threshold rules |
| `heartbeat` | `HeartbeatEvent` | Emitted on L1 ping completion with roundtrip latency and uptime |
| `engine_status` | `EngineStats` | Periodic broadcast of aggregated worker pool stats and queue depths |

### 5.5 Engine Statistics Aggregation

`engine.getEngineStats()` computes real-time diagnostic telemetry for the monitoring platform itself:

```typescript
export interface EngineStats {
  status: "INIT" | "RUNNING" | "PAUSED" | "STOPPED";
  totalEndpoints: number;
  activeEndpoints: number;
  totalPollsExecuted: number;
  totalPollErrors: number;
  pollsPerSecond: number;
  uptimeSeconds: number;
  zones: Array<{
    zone: string;
    activeWorkers: number;
    queuedTasks: number;
    maxConcurrency: number;
  }>;
  circuitBreakers: {
    closed: number;
    open: number;
    halfOpen: number;
    trippedEndpoints: string[];
  };
  ringBufferMemoryBytes: number;
}
```

---

## 6. TypeScript Interface & Type Definitions (`src/types/polling.ts`)

```typescript
import { DatabaseEngine, DBInstance, IncidentAlert, MetricPoint } from "./dba";

export type CadenceTier = "L1" | "L2" | "L3";

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerConfig {
  failureThreshold: number;       // default: 3
  baseResetTimeoutMs: number;     // default: 10,000ms
  maxResetTimeoutMs: number;      // default: 300,000ms (5 min)
  jitterFactor: number;           // default: 0.25 (±25%)
  executionTimeoutMs: number;     // default: 5,000ms
}

export interface CircuitBreakerStatus {
  endpointId: string;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveTrips: number;
  nextAttemptTimestamp: number;
}

export interface CadenceConfig {
  l1IntervalMs: number;           // default: 5,000ms (Heartbeat)
  l2IntervalMs: number;           // default: 30,000ms (Telemetry)
  l3IntervalMs: number;           // default: 300,000ms (Deep Diagnostics)
  adaptiveThrottlingEnabled: boolean; // default: true
  adaptiveCpuThresholdPct: number;    // default: 90%
  adaptiveConnThresholdPct: number;   // default: 90%
  adaptiveL3Multiplier: number;       // default: 2.0
}

export interface PollingEndpoint {
  id: string;
  name: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  databaseName: string;
  zone: string;                   // e.g. "us-east-1", "eu-west-1", "apac-prod"
  enabled: boolean;
  credentials?: {
    username?: string;
    password?: string;
    authType?: "password" | "key" | "sso";
  };
  cadenceConfig?: Partial<CadenceConfig>;
}

export interface QueuedTask<T> {
  id: string;
  priority: number;              // 3 = L1 (Highest), 2 = L2, 1 = L3 (Normal)
  endpointId: string;
  tier: CadenceTier;
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  createdAt: number;
}

export interface WorkerPoolConfig {
  zone: string;
  maxConcurrency: number;         // default: 10 per zone
  maxQueueSize: number;           // default: 500
}

export interface TelemetrySample {
  instanceId: string;
  timestamp: string;
  cpu: number;
  memory: number;
  iops: number;
  activeConnections: number;
  maxConnections: number;
  queryLatencyMs: number;
  slowQueryCount: number;
  replicationLagSeconds: number;
  bufferHitRatio: number;
  deadlocksCount: number;
  diskFreeGb: number;
  diskTotalGb: number;
  engineSpecific?: Record<string, any>;
}

export interface RollingStats {
  min: number;
  max: number;
  avg: number;
  latest: number;
  p95: number;
  count: number;
}

export interface RollingMetricsSummary {
  instanceId: string;
  sampleCount: number;
  timeWindowSeconds: number;
  cpu: RollingStats;
  memory: RollingStats;
  iops: RollingStats;
  latencyMs: RollingStats;
  activeConnections: RollingStats;
  bufferHitRatio: RollingStats;
}

export interface ITelemetryRingBuffer<T> {
  readonly capacity: number;
  readonly size: number;
  readonly latest: T | null;
  push(item: T): void;
  toArray(): T[];
  getRange(sinceTimestampMs: number): T[];
  clear(): void;
  getRollingStats(extractor: (sample: T) => number): RollingStats;
  getMetricSummary(): RollingMetricsSummary;
}

export interface TelemetryDeltaEvent {
  instanceId: string;
  timestamp: string;
  tier: CadenceTier;
  metrics: Partial<DBInstance>;
  hostMetrics?: any;
}

export interface CircuitStateEvent {
  endpointId: string;
  state: CircuitState;
  consecutiveFailures: number;
  nextAttemptTimestamp: number;
  reason?: string;
}

export interface HeartbeatEvent {
  endpointId: string;
  timestamp: string;
  uptimeSeconds: number;
  latencyMs: number;
  status: "ONLINE" | "UNREACHABLE" | "DEGRADED";
}

export interface IEndpointCollector {
  collectL1(endpoint: PollingEndpoint): Promise<Partial<DBInstance>>;
  collectL2(endpoint: PollingEndpoint): Promise<Partial<DBInstance>>;
  collectL3(endpoint: PollingEndpoint): Promise<Partial<DBInstance>>;
}
```

---

## 7. Edge Cases, Failure Modes & Resilience Analysis

| Failure Scenario | Root Cause | Impact | Mitigation / Solution in Polling Engine |
| :--- | :--- | :--- | :--- |
| **Endpoint Outage / Hang** | Network partition or DB freeze causes queries to hang indefinitely | Node.js socket exhaustion, worker pool starvation | `EndpointCircuitBreaker` with 5000ms query timeout. After 3 failures, breaker opens and fast-fails all queries in $<1\text{ms}$ without opening sockets. |
| **Thundering Herd after Recovery** | 50 databases recover from network partition at the same time | Synchronous connection spike saturates DB listeners | Exponential backoff with **$\pm 25\%$ randomized full jitter** uniformly spaces retry probes over time. |
| **Query Storm under High CPU** | Monitoring runs heavy L3 queries during peak customer traffic | Monitoring queries worsen DB lock contention | `TieredScheduler` **Adaptive Throttler** detects CPU > 90% and doubles L3 interval ($5\text{m} \to 10\text{m}$) with 2-tick recovery hysteresis. |
| **Event Loop Lag on Large Payload** | Parsing massive 5MB tablespace / deadlock dump blocks V8 event loop | SSE stream frame drops, frontend lag | Concurrency bounding (10 per zone) + chunked async JSON parsing + bounded ring buffers ensure $<40\text{ms}$ event loop latency. |
| **Memory Leak from Unbounded Buffers** | Continuous polling over days/weeks creates millions of metric objects | V8 heap OOM crash | `TelemetryRingBuffer` uses fixed-size array (60 items) with pointer overwrites and immediate dereferencing of evicted entries. Total heap $<8.5\text{MB}$ for 200 targets. |
| **Slow Collector Overlapping Ticks** | Collector execution takes 7s while L1 cadence is 5s | Multiple concurrent polls for same endpoint pile up | `TieredScheduler` tracks `isPollInFlight` per endpoint per tier. If a poll is currently in-flight when next tick arrives, the tick is skipped rather than stacked. |

---

## 8. Verification & Test Recipes for M4 Test Track

### 8.1 TieredScheduler Unit Test Matrix
1. **Cadence Verification**: Verify that L1 fires at 5s, L2 at 30s, and L3 at 300s using mock timers (`vi.useFakeTimers()`).
2. **Priority Dispatch**: Verify that L1 tasks are dispatched with priority 3, L2 with priority 2, L3 with priority 1.
3. **Adaptive Throttling**:
   - Feed L2 result with `cpuUsage: 94%`.
   - Verify scheduler doubles L3 interval from 300s to 600s.
   - Feed L2 result with `cpuUsage: 70%` for 1 tick -> verify L3 remains 600s (hysteresis).
   - Feed L2 result with `cpuUsage: 70%` for 2nd tick -> verify L3 restores to 300s.
4. **Lifecycle**: Test `start()`, `pause()`, `resume()`, `stop()`, `registerEndpoint()`, `unregisterEndpoint()`, and `onDemandPoll()`.

### 8.2 TelemetryRingBuffer Unit Test Matrix
1. **Capacity & Eviction**:
   - Create buffer of capacity 5. Push 7 items (`[1, 2, 3, 4, 5, 6, 7]`).
   - Verify `size === 5`.
   - Verify `toArray()` returns `[3, 4, 5, 6, 7]`.
   - Verify `latest === 7`.
2. **Rolling Statistics Accuracy**:
   - Push samples with CPU `[20, 40, 60, 80, 100]`.
   - Verify `min === 20`, `max === 100`, `avg === 60`.
3. **Memory Isolation**:
   - Verify `clear()` resets count to 0, fills buffer with `null`, and releases all object references.

### 8.3 PollingEngine Load & Scalability Test Matrix (100+ Endpoints)
1. **Simulate 120 Endpoints** across 4 zones (`us-east-1`, `eu-west-1`, `ap-southeast-1`, `onprem-dc1`).
2. **Run 100 Simulated Ticks**:
   - Verify `activeWorkers` per zone never exceeds `maxConcurrency` (10).
   - Verify event loop delay remains $<40\text{ms}$.
   - Verify process heap growth is bounded $<15\text{MB}$.
   - Verify SSE events are broadcast in real-time.
