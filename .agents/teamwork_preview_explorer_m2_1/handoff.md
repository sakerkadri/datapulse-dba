# Handoff Report: BoundedWorkerPool & EndpointCircuitBreaker Architecture

**Agent:** Explorer 1 (`teamwork_preview_explorer_m2_1`)  
**Milestone:** Milestone 2 — Scalable Centralized Polling Engine  
**Date:** 2026-08-19  
**Type:** Hard Handoff (Task Complete)  

---

## 1. Observation

1. **Architecture & Scope Constraints**:
   - `SCOPE.md` lines 6–8 specify:
     ```markdown
     - `BoundedWorkerPool.ts`: Location-aware/zone-partitioned worker pool for 100+ endpoints with priority queuing (L1 > L2 > L3) preventing socket exhaustion and event loop lag.
     - `CircuitBreaker.ts`: Resilient `EndpointCircuitBreaker` with `CLOSED`, `OPEN`, `HALF_OPEN` states, exponential backoff ($T_{\text{base}} \times 2^{\text{trips}}$), and randomized jitter ($\pm 25\%$).
     ```
   - `PROJECT.md` lines 18–20 and 108–114 specify the code layout under `src/server/polling/`:
     - `BoundedWorkerPool.ts`: Zone-aware concurrency-bounded worker queues.
     - `CircuitBreaker.ts`: Resilient circuit breaker with exponential backoff & jitter.
     - `tests/unit/pollingEngine.test.ts`: Unit tests covering worker pool and circuit breaker.
   - `SKILL.md` (`distributed-polling-engine`) lines 16–53 provide the baseline bounded worker pool with unbounded queue and no priority, and lines 73–85 define the circuit breaker parameters.
   - `src/types/dba.ts` lines 8–46 specify the `DBInstance` structure and engine types. Currently `src/types/polling.ts` does not yet exist and needs to be created to house unified polling types.

2. **Existing Project Dependencies & Tooling**:
   - `package.json` lines 30–40 show `tsx` (`^4.21.0`), `typescript` (`~5.8.2`), `esbuild` (`^0.25.0`), `node` (`v20.20.2`). Tests can be executed using Node's built-in test runner with `tsx` (e.g. `npx tsx --test tests/unit/pollingEngine.test.ts`).

3. **Performance & Scalability Requirements**:
   - Polling 100+ endpoints simultaneously without concurrency bounds leads to socket descriptor exhaustion (`EMFILE`) and high event loop latency.
   - Using $O(N \log N)$ `Array.prototype.sort()` on every task enqueue under 100+ endpoints creates unnecessary CPU load on the single-threaded Node.js event loop.
   - An $O(1)$ tri-bucket priority queue (Priority 3 = L1 Heartbeat, Priority 2 = L2 Telemetry, Priority 1 = L3 Deep Diagnostics) eliminates sorting overhead while naturally maintaining deterministic FIFO order within each priority tier.

---

## 2. Logic Chain

1. **Step 1 — Concurrency & Network Isolation (from Observation 1 & 3)**:
   - Polling targets are distributed across multiple geographic regions (`us-east-1`, `eu-west-1`, `ap-southeast-1`, `onprem-dc1`).
   - If all endpoints share a single worker pool, high network latency or outages in one zone would monopolize worker slots and starve healthy zones.
   - **Inference**: Polling must be partitioned by network zone (`zoneId`), with dedicated `BoundedWorkerPool` instances managed by a global `ZoneWorkerPoolManager`. Default per-zone concurrency $C_{\text{zone}} = 10$, max global concurrency $C_{\text{global}} = 50$.

2. **Step 2 — Tri-Bucket Priority Scheduling (from Observation 1 & 3)**:
   - Polling operations have distinct operational SLAs:
     - L1 Heartbeat (5–10s, sub-second timeout) must never wait behind L3 Deep Diagnostics (5–15m, 15s timeout).
     - Standard priority queues using array sort execute in $O(N \log N)$.
   - **Inference**: Implementing discrete priority buckets (`buckets[3]` for L1, `buckets[2]` for L2, `buckets[1]` for L3) achieves $O(1)$ constant-time enqueue and dequeue. FIFO tie-breaking is naturally preserved by array `push`/`shift`.

3. **Step 3 — Priority-Aware Queue Overflow Defense (from Observation 1)**:
   - If a target endpoint or datacenter hangs, tasks can accumulate in the queue.
   - Unbounded queues cause memory growth and eventual Node.js OOM.
   - **Inference**: Enforce `maxQueueSize` (default 500 tasks per pool). If full and a new L1 Heartbeat task arrives, evict the oldest L3 Diagnostic task from `buckets[1]` to prioritize the heartbeat. If no lower-priority task exists, reject the new task with `QueueOverflowError`.

4. **Step 4 — Resilient Circuit Breaker State Machine (from Observation 1)**:
   - Dead databases or dropped network links cause continuous polling timeouts.
   - Tripping to `OPEN` state after 3 consecutive failures allows subsequent calls to **fast-fail in $< 1\,\text{ms}$** with 0 socket I/O.
   - Setting $T_{\text{cooldown}} = \min(T_{\text{max}}, T_{\text{base}} \times 2^{\text{trips}-1}) \times (1 - 0.25 + 0.5 \times \text{Math.random}())$ applies exponential backoff ($10\text{s} \to 20\text{s} \to 40\text{s} \to 80\text{s} \to 160\text{s} \to 300\text{s}$) with uniform $\pm 25\%$ jitter to prevent thundering herd reconnection storms.
   - In `HALF_OPEN` state, a single probe guard (`halfOpenProbeInFlight`) prevents concurrent pollers from hammering the recovering database.

5. **Step 5 — Execution Timeout Containment (from Observation 1 & 2)**:
   - Database client queries or SSH commands can hang on dead TCP sockets indefinitely.
   - **Inference**: Wrapping all executions in `withTimeout(promise, timeoutMs)` (e.g. 5,000ms) with clean `clearTimeout` ensures hanging calls are terminated and registered as failures, preventing worker slot leakage.

---

## 3. Caveats

1. **Network Cancellation**: In JavaScript/Node.js, while `withTimeout` rejects the promise after the timeout period, underlying TCP sockets must also be aborted by database/SSH drivers (e.g. via `AbortController` or query cancellation tokens) to release socket resources immediately.
2. **Collector Implementations**: `BoundedWorkerPool` and `EndpointCircuitBreaker` provide the concurrency and resilience orchestration layers; the actual engine-specific collection queries are implemented in `src/server/collectors/` (OracleCollector, PostgresCollector, etc.).
3. **Timer Mocking in Tests**: Testing exponential backoff and jitter with real `setTimeout` will slow down unit tests. The test suite should support mock clocks or configurable base cooldowns (e.g. `baseResetTimeoutMs: 50ms` in test fixtures).

---

## 4. Conclusion & Concrete Code Signatures

### 4.1 Implementation Code Signatures

#### A. Core Types (`src/types/polling.ts`)
```typescript
import { DBInstance } from "./dba";

export type CadenceTier = "L1" | "L2" | "L3";

export enum TaskPriority {
  L3_DIAGNOSTICS = 1,
  L2_TELEMETRY = 2,
  L1_HEARTBEAT = 3,
}

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface QueuedTask<T> {
  id: string;
  priority: number; // 3 = L1, 2 = L2, 1 = L3
  endpointId: string;
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  createdAt: number;
  sequenceId: number;
}

export interface WorkerPoolConfig {
  zone: string;
  maxConcurrency?: number; // Default: 10
  maxQueueSize?: number;   // Default: 500
}

export interface WorkerPoolStats {
  zone: string;
  activeWorkers: number;
  queuedTasks: number;
  queuedL1: number;
  queuedL2: number;
  queuedL3: number;
  maxConcurrency: number;
  maxQueueSize: number;
  totalExecuted: number;
  totalFailed: number;
  totalEvicted: number;
  totalRejected: number;
  avgExecutionTimeMs: number;
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;     // Default: 3
  baseResetTimeoutMs?: number;   // Default: 10,000ms
  maxResetTimeoutMs?: number;    // Default: 300,000ms (5 min)
  jitterFactor?: number;         // Default: 0.25 (±25%)
  executionTimeoutMs?: number;   // Default: 5,000ms
}

export interface CircuitBreakerStatus {
  endpointId: string;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveTrips: number;
  nextAttemptTimestamp: number;
  cooldownRemainingMs: number;
  halfOpenProbeInFlight: boolean;
  lastFailureReason?: string;
  lastStateChangeTimestamp: number;
  totalTrips: number;
  totalSuccesses: number;
}
```

#### B. `BoundedWorkerPool` (`src/server/polling/BoundedWorkerPool.ts`)
```typescript
export class BoundedWorkerPool {
  private activeWorkers = 0;
  private buckets: Record<number, QueuedTask<any>[]> = { 3: [], 2: [], 1: [] };
  private sequenceCounter = 0;
  private totalExecuted = 0;
  private totalFailed = 0;
  private totalEvicted = 0;
  private totalRejected = 0;
  private executionTimes: number[] = [];

  constructor(
    public readonly zone: string,
    public readonly maxConcurrency: number = 10,
    public readonly maxQueueSize: number = 500
  ) {}

  async run<T>(endpointId: string, task: () => Promise<T>, priority: number = 2): Promise<T> {
    const validPriority = Math.min(3, Math.max(1, priority));
    const totalQueued = this.queuedTasks;

    if (totalQueued >= this.maxQueueSize) {
      // Priority-aware eviction: if new task is L1 (3) and L3 (1) has items, evict oldest L3
      if (validPriority === 3 && this.buckets[1].length > 0) {
        const evicted = this.buckets[1].shift()!;
        this.totalEvicted++;
        evicted.reject(new Error(`[WorkerPool:${this.zone}] Task evicted in favor of higher priority L1 Heartbeat`));
      } else {
        this.totalRejected++;
        throw new Error(`[WorkerPool:${this.zone}] Queue overflow (${totalQueued} tasks). Dropping task for ${endpointId}`);
      }
    }

    return new Promise<T>((resolve, reject) => {
      const queuedItem: QueuedTask<T> = {
        id: `task_${Date.now()}_${++this.sequenceCounter}`,
        priority: validPriority,
        endpointId,
        execute: task,
        resolve,
        reject,
        createdAt: Date.now(),
        sequenceId: this.sequenceCounter,
      };

      if (this.activeWorkers < this.maxConcurrency) {
        this.dispatch(queuedItem);
      } else {
        this.buckets[validPriority].push(queuedItem);
      }
    });
  }

  private async dispatch(item: QueuedTask<any>) {
    this.activeWorkers++;
    const start = Date.now();
    try {
      const result = await item.execute();
      this.totalExecuted++;
      this.recordDuration(Date.now() - start);
      item.resolve(result);
    } catch (err) {
      this.totalFailed++;
      item.reject(err);
    } finally {
      this.activeWorkers--;
      this.drainNext();
    }
  }

  private drainNext() {
    if (this.activeWorkers < this.maxConcurrency) {
      const nextTask = this.buckets[3].shift() || this.buckets[2].shift() || this.buckets[1].shift();
      if (nextTask) {
        this.dispatch(nextTask);
      }
    }
  }

  get queuedTasks(): number {
    return this.buckets[3].length + this.buckets[2].length + this.buckets[1].length;
  }

  get stats(): WorkerPoolStats {
    const avg = this.executionTimes.length > 0
      ? Math.round(this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length)
      : 0;
    return {
      zone: this.zone,
      activeWorkers: this.activeWorkers,
      queuedTasks: this.queuedTasks,
      queuedL1: this.buckets[3].length,
      queuedL2: this.buckets[2].length,
      queuedL3: this.buckets[1].length,
      maxConcurrency: this.maxConcurrency,
      maxQueueSize: this.maxQueueSize,
      totalExecuted: this.totalExecuted,
      totalFailed: this.totalFailed,
      totalEvicted: this.totalEvicted,
      totalRejected: this.totalRejected,
      avgExecutionTimeMs: avg,
    };
  }

  private recordDuration(ms: number) {
    this.executionTimes.push(ms);
    if (this.executionTimes.length > 100) this.executionTimes.shift();
  }
}
```

#### C. `EndpointCircuitBreaker` (`src/server/polling/CircuitBreaker.ts`)
```typescript
export class EndpointCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private consecutiveTrips = 0;
  private nextAttemptTimestamp = 0;
  private halfOpenProbeInFlight = false;
  private lastFailureReason?: string;
  private lastStateChangeTimestamp = Date.now();
  private totalTrips = 0;
  private totalSuccesses = 0;

  constructor(
    public readonly endpointId: string,
    private readonly config: CircuitBreakerConfig = {
      failureThreshold: 3,
      baseResetTimeoutMs: 10000,
      maxResetTimeoutMs: 300000,
      jitterFactor: 0.25,
      executionTimeoutMs: 5000,
    }
  ) {}

  getState(): CircuitState {
    if (this.state === CircuitState.OPEN && Date.now() >= this.nextAttemptTimestamp) {
      this.transitionTo(CircuitState.HALF_OPEN);
      this.halfOpenProbeInFlight = false;
    }
    return this.state;
  }

  async execute<T>(action: () => Promise<T>, fallback?: (reason: string) => T): Promise<T> {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      const waitRemaining = Math.max(0, this.nextAttemptTimestamp - Date.now());
      const msg = `Circuit is OPEN for [${this.endpointId}]. Fast-failing (<1ms). Next probe in ${Math.ceil(waitRemaining / 1000)}s.`;
      if (fallback) return fallback(msg);
      throw new Error(msg);
    }

    if (currentState === CircuitState.HALF_OPEN) {
      if (this.halfOpenProbeInFlight) {
        const msg = `Circuit is HALF_OPEN for [${this.endpointId}]. Recovery probe already in flight.`;
        if (fallback) return fallback(msg);
        throw new Error(msg);
      }
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await this.withTimeout(action(), this.config.executionTimeoutMs ?? 5000);
      this.onSuccess();
      return result;
    } catch (err: any) {
      const reason = err.message || "Unknown error";
      this.onFailure(reason);
      if (fallback) return fallback(`Execution failed: ${reason}`);
      throw err;
    }
  }

  private onSuccess() {
    this.consecutiveFailures = 0;
    this.consecutiveTrips = 0;
    this.halfOpenProbeInFlight = false;
    this.totalSuccesses++;
    if (this.state !== CircuitState.CLOSED) {
      this.transitionTo(CircuitState.CLOSED);
    }
  }

  private onFailure(reason: string) {
    this.consecutiveFailures++;
    this.lastFailureReason = reason;
    this.halfOpenProbeInFlight = false;

    if (this.state === CircuitState.HALF_OPEN || this.consecutiveFailures >= (this.config.failureThreshold ?? 3)) {
      this.trip(reason);
    }
  }

  private trip(reason: string) {
    this.transitionTo(CircuitState.OPEN);
    this.consecutiveTrips++;
    this.totalTrips++;

    const baseMs = this.config.baseResetTimeoutMs ?? 10000;
    const maxMs = this.config.maxResetTimeoutMs ?? 300000;
    const jitter = this.config.jitterFactor ?? 0.25;

    const rawBackoff = Math.min(maxMs, baseMs * Math.pow(2, this.consecutiveTrips - 1));
    const jitterMultiplier = 1 - jitter + 2 * jitter * Math.random();
    const cooldownWithJitter = Math.round(rawBackoff * jitterMultiplier);

    this.nextAttemptTimestamp = Date.now() + cooldownWithJitter;
  }

  private transitionTo(newState: CircuitState) {
    this.state = newState;
    this.lastStateChangeTimestamp = Date.now();
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms for endpoint [${this.endpointId}]`));
      }, timeoutMs);

      promise
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  get status(): CircuitBreakerStatus {
    return {
      endpointId: this.endpointId,
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveTrips: this.consecutiveTrips,
      nextAttemptTimestamp: this.nextAttemptTimestamp,
      cooldownRemainingMs: Math.max(0, this.nextAttemptTimestamp - Date.now()),
      halfOpenProbeInFlight: this.halfOpenProbeInFlight,
      lastFailureReason: this.lastFailureReason,
      lastStateChangeTimestamp: this.lastStateChangeTimestamp,
      totalTrips: this.totalTrips,
      totalSuccesses: this.totalSuccesses,
    };
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveTrips = 0;
    this.nextAttemptTimestamp = 0;
    this.halfOpenProbeInFlight = false;
    this.lastStateChangeTimestamp = Date.now();
  }
}
```

---

## 5. Verification Method

To independently verify this exploration and the downstream implementation:

1. **File Inspection**:
   - Verify `src/types/polling.ts` contains all exported types (`QueuedTask`, `WorkerPoolStats`, `CircuitBreakerConfig`, `CircuitBreakerStatus`, `CircuitState`, `TaskPriority`).
   - Verify `src/server/polling/BoundedWorkerPool.ts` implements the $O(1)$ tri-bucket queue, concurrency bounds, and eviction policy.
   - Verify `src/server/polling/CircuitBreaker.ts` implements `CLOSED` $\to$ `OPEN` $\to$ `HALF_OPEN` state transitions, exponential backoff, jitter formula, and execution timeout wrapper.

2. **Test Command Execution**:
   - Run the unit test suite via:
     ```bash
     npx tsx --test tests/unit/pollingEngine.test.ts
     ```
   - Verify:
     - Concurrency limit is strictly bounded under burst submissions.
     - Priority ordering executes L1 before L2 before L3.
     - Circuit breaker trips after 3 failures and fast-fails in $< 1\,\text{ms}$.
     - Full jitter produces values within $\pm 25\%$ of exponential backoff baseline.
     - Single probe in `HALF_OPEN` prevents concurrent probe execution.
     - Recovery restores state to `CLOSED` and resets trip counters.

3. **Invalidation Conditions**:
   - If priority sorting uses $O(N \log N)$ `Array.sort()`, it is invalidated due to event loop latency risks.
   - If `activeWorkers` leaks when a task throws an exception, it is invalidated.
   - If circuit breaker in `OPEN` state initiates network calls instead of fast-failing in $<1\text{ms}$, it is invalidated.
