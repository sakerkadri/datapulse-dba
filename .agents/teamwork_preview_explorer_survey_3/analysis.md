# Technical Architecture & Specification: Centralized Polling Engine (R2) & Agentless Host Infrastructure Monitoring (R3)

**Author:** teamwork_preview_explorer_survey_3  
**Date:** 2026-08-19  
**Status:** Completed Exploration & Specification  
**Target Systems:** DataPulse DBA Sentinel — Centralized Polling Core & Agentless Infrastructure Telemetry  

---

## 1. Executive Summary

This specification defines the complete technical architecture, algorithms, data structures, APIs, and verification strategies for:
1. **Requirement 2 (R2): Scalable Centralized Polling Engine**: A high-concurrency, zone-aware scheduler managing 100+ database and host targets with multi-tiered cadence (L1 Heartbeat 5–10s, L2 Telemetry 30–60s, L3 Deep Diagnostics 5–15m), resilient circuit breakers with exponential backoff and randomized jitter, and real-time Server-Sent Events (SSE) / WebSocket live streaming backed by in-memory fixed-size ring buffers.
2. **Requirement 3 (R3): Agentless Server Infrastructure Monitoring**: Zero-agent host telemetry collection for Linux via persistent SSH connection pooling and atomic single-command `/proc` batch sampling, and Windows via WinRM / WMI (WQL queries), combined with a real-time **Host-to-DB Correlation Engine** that maps host hardware saturation (CPU, RAM, Disk I/O, Swap) to database performance anomalies (query latency, wait events, buffer hit degradation).

---

## 2. R2: Scalable Centralized Polling Engine Architecture

```
                                  ┌────────────────────────────────────────────────────────┐
                                  │             CENTRAL POLLING COORDINATOR                │
                                  │   (Tiered Cadence Scheduler: L1 5s, L2 30s, L3 5m)     │
                                  └──────────────────────────┬─────────────────────────────┘
                                                             │
                              ┌──────────────────────────────┴─────────────────────────────┐
                              ▼                                                            ▼
               ┌─────────────────────────────┐                              ┌─────────────────────────────┐
               │    ZONE POOL: us-east-1     │                              │    ZONE POOL: eu-west-1     │
               │ (Bounded Concurrency = 10)  │                              │ (Bounded Concurrency = 10)  │
               └──────────────┬──────────────┘                              └──────────────┬──────────────┘
                              │                                                            │
                 ┌────────────┴────────────┐                                  ┌────────────┴────────────┐
                 ▼                         ▼                                  ▼                         ▼
         ┌───────────────┐         ┌───────────────┐                  ┌───────────────┐         ┌───────────────┐
         │ CircuitBreaker│         │ CircuitBreaker│                  │ CircuitBreaker│         │ CircuitBreaker│
         │  [DB: pg-01]  │         │ [Host: lnx-01]│                  │ [DB: ora-01]  │         │[Host: win-01] │
         └───────┬───────┘         └───────┬───────┘                  └───────┬───────┘         └───────┬───────┘
                 │                         │                                  │                         │
                 ▼                         ▼                                  ▼                         ▼
         ┌───────────────┐         ┌───────────────┐                  ┌───────────────┐         ┌───────────────┐
         │  Postgres SQL │         │  SSH /proc    │                  │  Oracle Thin  │         │ WinRM / WMI   │
         │  Client Pool  │         │  Batch Script │                  │  Driver Pool  │         │  WQL Client   │
         └───────┬───────┘         └───────┬───────┘                  └───────┬───────┘         └───────┬───────┘
                 │                         │                                  │                         │
                 └─────────────────────────┴────────────────┬─────────────────┴─────────────────────────┘
                                                            │
                                                            ▼
                                           ┌─────────────────────────────────┐
                                           │    IN-MEMORY RING BUFFER CACHE  │
                                           │ (Fixed-size circular telemetry) │
                                           └────────────────┬────────────────┘
                                                            │
                                           ┌────────────────┴────────────────┐
                                           │     HOST-TO-DB CORRELATION      │
                                           │  Cross-layer Root Cause Engine  │
                                           └────────────────┬────────────────┘
                                                            │
                                           ┌────────────────┴────────────────┐
                                           │  REAL-TIME SSE / WS STREAMING   │
                                           │     Broadcast to UI Clients     │
                                           └─────────────────────────────────┘
```

### 2.1 Zone-Aware Bounded Worker Pools

#### Problem Statement
Executing asynchronous network requests across 100+ database endpoints and 100+ host servers without strict concurrency bounding causes:
1. `libuv` socket descriptor exhaustion (`EMFILE`, `ENFILE`, `ETIMEDOUT`).
2. WAN/VPN tunnel congestion when querying remote regions simultaneously.
3. Event loop latency spikes from concurrent large payload parsing.
4. Connection storms / thundering herd on monitored database servers.

#### Algorithmic Design
- Targets are partitioned into **Network Zones** (`zoneId`, e.g., `us-east-1`, `eu-west-1`, `ap-southeast-1`, `onprem-dc1`).
- Each zone is assigned a dedicated `BoundedWorkerPool` with a configurable concurrency limit (default: 10 concurrent active connections per zone, global cap = 50).
- Tasks are prioritized: **L1 Heartbeat (Priority 3)** > **L2 Telemetry (Priority 2)** > **L3 Deep Diagnostics (Priority 1)**.
- Priority queue ensures critical heartbeats are never blocked behind 2-second tablespace catalog queries.

#### Implementation Contract
```typescript
export interface QueuedTask<T> {
  id: string;
  priority: number; // 3 = L1, 2 = L2, 1 = L3
  endpointId: string;
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  createdAt: number;
}

export class BoundedWorkerPool {
  private activeWorkers = 0;
  private queue: QueuedTask<any>[] = [];

  constructor(
    public readonly zone: string,
    public readonly maxConcurrency: number = 10,
    public readonly maxQueueSize: number = 500
  ) {}

  async run<T>(endpointId: string, task: () => Promise<T>, priority: number = 1): Promise<T> {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(`[WorkerPool:${this.zone}] Queue overflow (${this.queue.length} tasks). Dropping task for ${endpointId}`);
    }

    return new Promise<T>((resolve, reject) => {
      const queuedItem: QueuedTask<T> = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        priority,
        endpointId,
        execute: task,
        resolve,
        reject,
        createdAt: Date.now(),
      };

      if (this.activeWorkers < this.maxConcurrency) {
        this.dispatch(queuedItem);
      } else {
        this.queue.push(queuedItem);
        // Sort descending by priority, tie-broken by oldest createdAt (FIFO within priority)
        this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
      }
    });
  }

  private async dispatch(item: QueuedTask<any>) {
    this.activeWorkers++;
    try {
      const result = await item.execute();
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.activeWorkers--;
      this.drainNext();
    }
  }

  private drainNext() {
    if (this.queue.length > 0 && this.activeWorkers < this.maxConcurrency) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        this.dispatch(nextTask);
      }
    }
  }

  get stats() {
    return {
      zone: this.zone,
      activeWorkers: this.activeWorkers,
      queuedTasks: this.queue.length,
      maxConcurrency: this.maxConcurrency,
    };
  }
}
```

---

### 2.2 Multi-Tiered Adaptive Cadence Scheduling

Metric collection is divided into 3 distinct operational tiers:

| Tier | Name | Cadence | Execution Timeout | Target Metrics | Network Overhead | SLA / Failure Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **L1** | **Heartbeat** | **5 – 10 sec** | 2,000 ms | TCP ping, TCP connect latency, basic `SELECT 1`, active sessions count, uptime | $< 100$ bytes | Mark `CRITICAL/UNREACHABLE` if $\ge 2$ consecutive failures; trip breaker if 3 failures. |
| **L2** | **Telemetry** | **30 – 60 sec** | 5,000 ms | CPU%, Memory%, IOPS, Query Latency, Buffer Hit Ratio, Replication Lag, Active/Idle connections | $1 - 5$ KB | Append metric point to in-memory Ring Buffer and broadcast delta to SSE/WS stream. |
| **L3** | **Deep Diagnostics** | **5 – 15 min** | 15,000 ms | Tablespace autoextend headroom, ASM diskgroups, segment fragmentation, Top 10 wait events, deadlock history, slow query logs, background process states | $15 - 50$ KB | Cache summary in memory for capacity forecasting, DBA reports, and AI diagnostic baseline. |

#### Adaptive Cadence Throttling
When a database is under extreme load (e.g. CPU > 95% or active connections > 90% of max), the engine automatically throttles L3 deep diagnostics by doubling the L3 interval (e.g. $5\text{m} \to 10\text{m}$) to prevent monitoring queries from exacerbating lock contention or CPU exhaustion.

---

### 2.3 Circuit Breaker with Exponential Backoff & Jitter

#### Circuit States
1. **`CLOSED`**: Healthy operation. All L1, L2, L3 queries execute normally. Consecutive failure counter is reset to 0 upon any successful poll.
2. **`OPEN`**: Target is failing (e.g., connection refused, query timeout, network partition). Polling calls **fast-fail immediately** in $< 1\,\text{ms}$ without opening sockets or spawning subprocesses. Prevents socket starvation.
3. **`HALF_OPEN`**: Cooldown window has elapsed. A single lightweight probe (L1 Heartbeat) is dispatched:
   - If probe **succeeds**: Circuit transitions to `CLOSED`, resetting all backoff counters.
   - If probe **fails**: Circuit reverts to `OPEN`, incrementing consecutive trips and doubling the cooldown period.

#### Mathematical Formulas
- **Exponential Backoff Formula**:
  $$T_{\text{backoff}} = \min\left(T_{\text{max}}, T_{\text{base}} \times 2^{\text{consecutive\_trips}}\right)$$
  where $T_{\text{base}} = 10,000\,\text{ms}$ (10s), $T_{\text{max}} = 300,000\,\text{ms}$ (5 minutes).

- **Full Jitter Formula** (avoids synchronized thundering herds across 100+ endpoints after network restore):
  $$T_{\text{cooldown}} = T_{\text{backoff}} \times (1 - \alpha + 2\alpha \times \text{Math.random}())$$
  where $\alpha = 0.25$ (providing a $\pm 25\%$ uniform random distribution).

#### Circuit Breaker Implementation Contract
```typescript
export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // e.g. 3 consecutive failures
  baseResetTimeoutMs: number; // e.g. 10,000ms
  maxResetTimeoutMs: number; // e.g. 300,000ms (5 min)
  jitterFactor: number; // e.g. 0.25 (±25%)
  executionTimeoutMs: number; // e.g. 5,000ms
}

export class EndpointCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private consecutiveTrips = 0;
  private nextAttemptTimestamp = 0;
  private halfOpenProbeInFlight = false;

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
      this.state = CircuitState.HALF_OPEN;
      this.halfOpenProbeInFlight = false;
    }
    return this.state;
  }

  async execute<T>(action: () => Promise<T>, fallback: (reason: string) => T): Promise<T> {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      const waitRemaining = Math.max(0, this.nextAttemptTimestamp - Date.now());
      return fallback(`Circuit is OPEN. Fast-failing without network call. Next retry in ${Math.round(waitRemaining / 1000)}s.`);
    }

    if (currentState === CircuitState.HALF_OPEN) {
      if (this.halfOpenProbeInFlight) {
        return fallback(`Circuit is HALF_OPEN. Probe already in flight.`);
      }
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await this.withTimeout(action(), this.config.executionTimeoutMs);
      this.onSuccess();
      return result;
    } catch (err: any) {
      this.onFailure(err.message || "Unknown error");
      return fallback(`Poll execution failed: ${err.message}`);
    }
  }

  private onSuccess() {
    this.consecutiveFailures = 0;
    this.consecutiveTrips = 0;
    this.state = CircuitState.CLOSED;
    this.halfOpenProbeInFlight = false;
  }

  private onFailure(reason: string) {
    this.consecutiveFailures++;
    this.halfOpenProbeInFlight = false;

    if (this.state === CircuitState.HALF_OPEN || this.consecutiveFailures >= this.config.failureThreshold) {
      this.trip(reason);
    }
  }

  private trip(reason: string) {
    this.state = CircuitState.OPEN;
    this.consecutiveTrips++;

    const rawBackoff = Math.min(
      this.config.maxResetTimeoutMs,
      this.config.baseResetTimeoutMs * Math.pow(2, this.consecutiveTrips - 1)
    );

    // Apply full jitter: [rawBackoff * (1 - jitter), rawBackoff * (1 + jitter)]
    const jitterMultiplier = 1 - this.config.jitterFactor + 2 * this.config.jitterFactor * Math.random();
    const cooldownWithJitter = Math.round(rawBackoff * jitterMultiplier);

    this.nextAttemptTimestamp = Date.now() + cooldownWithJitter;
    console.warn(`[CircuitBreaker:${this.endpointId}] TRIPPED to OPEN (Trip #${this.consecutiveTrips}). Reason: ${reason}. Cooldown: ${cooldownWithJitter}ms`);
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms`));
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

  get status() {
    return {
      endpointId: this.endpointId,
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveTrips: this.consecutiveTrips,
      nextAttemptTimestamp: this.nextAttemptTimestamp,
    };
  }
}
```

---

### 2.4 Live Streaming Pipeline: Sliding Window Ring Buffer & SSE

#### In-Memory Sliding Window Ring Buffer
- Fixed memory footprint: Each target endpoint maintains a circular buffer of $N$ data points (default $N = 60$ points, representing 30 minutes at 30s cadence).
- $O(1)$ amortized insertion time, zero array re-allocation or memory leak risk.
- In-flight aggregation: Maintains rolling min/max/average stats on insert.

```typescript
export class TelemetryRingBuffer<T> {
  private buffer: (T | null)[];
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(public readonly capacity: number = 60) {
    this.buffer = new Array(capacity).fill(null);
  }

  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity; // Evict oldest
    }
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const val = this.buffer[idx];
      if (val !== null) result.push(val);
    }
    return result;
  }

  get latest(): T | null {
    if (this.count === 0) return null;
    const lastIdx = (this.tail - 1 + this.capacity) % this.capacity;
    return this.buffer[lastIdx];
  }

  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}
```

#### SSE Streaming Endpoint Design
- **Route**: `GET /api/stream/telemetry`
- **Query params**: `?targetId=db-pg-01&zone=us-east-1` (optional filter, default streams all active instances).
- **Behavior**:
  1. Sets headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
  2. Sends initial handshake frame containing snapshot from Ring Buffer (`event: snapshot`).
  3. Registers listener on Central Polling Engine EventEmitter.
  4. Broadcasts telemetry deltas whenever an L1 or L2 poll completes (`event: telemetry_delta`).
  5. Broadcasts incident alerts (`event: incident_fired`).
  6. Sends heartbeat keepalive (`:keepalive\n\n`) every 15s to prevent proxy/load-balancer timeouts.
  7. Cleans up listener on client disconnect (`req.on('close')`).

---

## 3. R3: Agentless Server Infrastructure Monitoring Architecture

### 3.1 Linux Agentless Host Monitoring (SSH)

#### Zero-Agent Architecture
- Connects directly to Linux host via SSH (port 22) using public key or credential authentication.
- Uses persistent SSH connection pool (`ssh2` client pool with keepalive pings every 30s) to eliminate the 300–800ms TCP+TLS handshake latency on every poll.

#### Consolidated Single-Command Batch Sampling
To prevent process spawning overhead and latency jitter, the engine executes a single atomic composite shell payload:

```bash
cat << 'EOF' | /bin/sh
echo "===CPU==="
cat /proc/stat | grep '^cpu '
echo "===MEM==="
cat /proc/meminfo | grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):'
echo "===DISK==="
df -Pk -x tmpfs -x devtmpfs -x overlay -x iso9660 -x squashfs
echo "===LOAD==="
cat /proc/loadavg
echo "===IO==="
cat /proc/diskstats | head -n 25
echo "===UPTIME==="
cat /proc/uptime
EOF
```

#### TypeScript Linux Metric Parser & Formulas

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
  private prevCpuSample: LinuxProcSample | null = null;
  private prevDiskStats: Map<string, { reads: number; writes: number; time: number }> = new Map();

  parseBatchOutput(hostId: string, rawOutput: string): ParsedHostMetrics {
    const sections: Record<string, string> = {};
    let currentSection = "DEFAULT";

    for (const line of rawOutput.split("\n")) {
      const match = line.match(/^===([A-Z]+)===$/);
      if (match) {
        currentSection = match[1];
        sections[currentSection] = "";
      } else if (currentSection) {
        sections[currentSection] = (sections[currentSection] || "") + line + "\n";
      }
    }

    const cpu = this.parseCpu(sections["CPU"] || "");
    const mem = this.parseMem(sections["MEM"] || "");
    const disks = this.parseDisks(sections["DISK"] || "");
    const load = this.parseLoad(sections["LOAD"] || "");
    const uptime = this.parseUptime(sections["UPTIME"] || "");
    const iops = this.parseIO(sections["IO"] || "");

    return {
      hostId,
      timestamp: new Date().toISOString(),
      osType: "LINUX",
      cpuUsagePct: cpu.cpuUsagePct,
      cpuBreakdown: cpu.breakdown,
      memory: mem,
      disks,
      loadAverage: load,
      uptimeSeconds: uptime,
      iopsTotal: iops,
    };
  }

  private parseCpu(raw: string) {
    const parts = raw.trim().split(/\s+/).slice(1).map(Number);
    if (parts.length < 8) {
      return { cpuUsagePct: 0, breakdown: { userPct: 0, systemPct: 0, iowaitPct: 0, stealPct: 0 } };
    }

    const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
    const active = user + nice + system + irq + softirq + steal;
    const total = active + idle + iowait;

    const currentSample: LinuxProcSample = {
      cpuUser: user,
      cpuNice: nice,
      cpuSystem: system,
      cpuIdle: idle,
      cpuIowait: iowait,
      cpuIrq: irq,
      cpuSoftirq: softirq,
      cpuSteal: steal,
      totalActive: active,
      totalTime: total,
    };

    if (!this.prevCpuSample) {
      this.prevCpuSample = currentSample;
      return { cpuUsagePct: 0, breakdown: { userPct: 0, systemPct: 0, iowaitPct: 0, stealPct: 0 } };
    }

    const deltaActive = currentSample.totalActive - this.prevCpuSample.totalActive;
    const deltaTotal = currentSample.totalTime - this.prevCpuSample.totalTime;
    this.prevCpuSample = currentSample;

    if (deltaTotal <= 0) {
      return { cpuUsagePct: 0, breakdown: { userPct: 0, systemPct: 0, iowaitPct: 0, stealPct: 0 } };
    }

    const cpuUsagePct = Number(((deltaActive / deltaTotal) * 100).toFixed(1));
    const userPct = Number((((currentSample.cpuUser - this.prevCpuSample.cpuUser) / deltaTotal) * 100).toFixed(1));
    const systemPct = Number((((currentSample.cpuSystem - this.prevCpuSample.cpuSystem) / deltaTotal) * 100).toFixed(1));
    const iowaitPct = Number((((currentSample.cpuIowait - this.prevCpuSample.cpuIowait) / deltaTotal) * 100).toFixed(1));
    const stealPct = Number((((currentSample.cpuSteal - this.prevCpuSample.cpuSteal) / deltaTotal) * 100).toFixed(1));

    return {
      cpuUsagePct: Math.min(100, Math.max(0, cpuUsagePct)),
      breakdown: { userPct, systemPct, iowaitPct, stealPct },
    };
  }

  private parseMem(raw: string) {
    const map: Record<string, number> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Za-z]+):\s+(\d+)\s+kB/);
      if (match) {
        map[match[1]] = parseInt(match[2], 10);
      }
    }

    const totalKb = map["MemTotal"] || 1;
    const freeKb = map["MemFree"] || 0;
    const availKb = map["MemAvailable"] !== undefined ? map["MemAvailable"] : (freeKb + (map["Buffers"] || 0) + (map["Cached"] || 0));
    const usedKb = Math.max(0, totalKb - availKb);

    const swapTotalKb = map["SwapTotal"] || 0;
    const swapFreeKb = map["SwapFree"] || 0;
    const swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);

    return {
      totalGb: Number((totalKb / (1024 * 1024)).toFixed(2)),
      usedGb: Number((usedKb / (1024 * 1024)).toFixed(2)),
      availableGb: Number((availKb / (1024 * 1024)).toFixed(2)),
      usedPercent: Number(((usedKb / totalKb) * 100).toFixed(1)),
      swapTotalGb: Number((swapTotalKb / (1024 * 1024)).toFixed(2)),
      swapUsedGb: Number((swapUsedKb / (1024 * 1024)).toFixed(2)),
      swapUsedPercent: swapTotalKb > 0 ? Number(((swapUsedKb / swapTotalKb) * 100).toFixed(1)) : 0,
    };
  }

  private parseDisks(raw: string): HostDiskMount[] {
    const lines = raw.trim().split("\n");
    const disks: HostDiskMount[] = [];

    // Header line: Filesystem 1024-blocks Used Available Capacity Mounted on
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length >= 6) {
        const filesystem = parts[0];
        const blocks1k = parseInt(parts[1], 10);
        const used1k = parseInt(parts[2], 10);
        const avail1k = parseInt(parts[3], 10);
        const capacityStr = parts[4].replace("%", "");
        const mountPoint = parts[5];

        if (!isNaN(blocks1k) && blocks1k > 0) {
          disks.push({
            filesystem,
            totalGb: Number((blocks1k / (1024 * 1024)).toFixed(2)),
            usedGb: Number((used1k / (1024 * 1024)).toFixed(2)),
            availableGb: Number((avail1k / (1024 * 1024)).toFixed(2)),
            usedPercent: parseInt(capacityStr, 10) || 0,
            mountPoint,
          });
        }
      }
    }
    return disks;
  }

  private parseLoad(raw: string) {
    const parts = raw.trim().split(/\s+/);
    return {
      load1m: parseFloat(parts[0]) || 0,
      load5m: parseFloat(parts[1]) || 0,
      load15m: parseFloat(parts[2]) || 0,
    };
  }

  private parseUptime(raw: string): number {
    const parts = raw.trim().split(/\s+/);
    return Math.floor(parseFloat(parts[0]) || 0);
  }

  private parseIO(raw: string): number {
    let totalIops = 0;
    for (const line of raw.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 14) {
        const devName = parts[2];
        if (devName.startsWith("loop") || devName.startsWith("ram")) continue;
        const reads = parseInt(parts[3], 10) || 0;
        const writes = parseInt(parts[7], 10) || 0;
        totalIops += (reads + writes);
      }
    }
    return Math.min(50000, totalIops);
  }
}
```

---

### 3.2 Windows Agentless Host Monitoring (WinRM / WMI)

#### Protocol & Transport
- Uses **Windows Remote Management (WinRM)** running over HTTP (port 5985) or HTTPS (port 5986) implementing the WS-Management standard.
- Authenticates via NTLM / Negotiate / Basic-over-SSL using standard service credentials without requiring local agent daemons.

#### WQL Queries & Data Extraction

1. **CPU Utilization (`Win32_PerfFormattedData_PerfOS_Processor`)**:
   ```sql
   SELECT PercentProcessorTime, Name FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name = '_Total'
   ```
   *Fallback*: `SELECT LoadPercentage, NumberOfCores, NumberOfLogicalProcessors FROM Win32_Processor`

2. **Physical & Virtual Memory (`Win32_OperatingSystem`)**:
   ```sql
   SELECT TotalVisibleMemorySize, FreePhysicalMemory, TotalVirtualMemorySize, FreeVirtualMemory FROM Win32_OperatingSystem
   ```
   - Total MB = $\text{TotalVisibleMemorySize} / 1024$
   - Free MB = $\text{FreePhysicalMemory} / 1024$
   - Used MB = $\text{TotalMB} - \text{FreeMB}$
   - Used % = $\frac{\text{Used MB}}{\text{Total MB}} \times 100$

3. **Logical Storage Volumes (`Win32_LogicalDisk`)**:
   ```sql
   SELECT DeviceID, VolumeName, Size, FreeSpace, FileSystem, DriveType FROM Win32_LogicalDisk WHERE DriveType = 3
   ```
   - Filters strictly for `DriveType = 3` (Local Fixed Disks).
   - Computes: $\text{TotalGB} = \text{Size} / 1024^3$, $\text{FreeGB} = \text{FreeSpace} / 1024^3$, $\text{UsedPct} = \frac{\text{TotalGB} - \text{FreeGB}}{\text{TotalGB}} \times 100$.

4. **Disk I/O Performance (`Win32_PerfFormattedData_PerfDisk_PhysicalDisk`)**:
   ```sql
   SELECT DiskTransfersPerSec, DiskReadBytesPerSec, DiskWriteBytesPerSec, PercentDiskTime, Name FROM Win32_PerfFormattedData_PerfDisk_PhysicalDisk WHERE Name = '_Total'
   ```

#### TypeScript Windows Metric Parser Contract
```typescript
export class WindowsWmiMetricParser {
  parseWmiPayload(hostId: string, payload: {
    cpu?: { PercentProcessorTime?: number; LoadPercentage?: number };
    os?: { TotalVisibleMemorySize?: number; FreePhysicalMemory?: number; TotalVirtualMemorySize?: number; FreeVirtualMemory?: number; LastBootUpTime?: string };
    disks?: Array<{ DeviceID: string; VolumeName?: string; Size?: number; FreeSpace?: number; FileSystem?: string }>;
    diskPerf?: { DiskTransfersPerSec?: number };
  }): ParsedHostMetrics {
    // 1. CPU
    const cpuUsagePct = payload.cpu?.PercentProcessorTime !== undefined
      ? Number(payload.cpu.PercentProcessorTime)
      : Number(payload.cpu?.LoadPercentage || 0);

    // 2. Memory (Values in KB)
    const totalMemKb = payload.os?.TotalVisibleMemorySize || 1;
    const freeMemKb = payload.os?.FreePhysicalMemory || 0;
    const usedMemKb = Math.max(0, totalMemKb - freeMemKb);
    const memUsedPct = Number(((usedMemKb / totalMemKb) * 100).toFixed(1));

    // 3. Disks
    const disks: HostDiskMount[] = (payload.disks || []).map((d) => {
      const sizeBytes = Number(d.Size || 0);
      const freeBytes = Number(d.FreeSpace || 0);
      const usedBytes = Math.max(0, sizeBytes - freeBytes);
      const totalGb = Number((sizeBytes / (1024 ** 3)).toFixed(2));
      const usedGb = Number((usedBytes / (1024 ** 3)).toFixed(2));
      const availGb = Number((freeBytes / (1024 ** 3)).toFixed(2));
      const usedPercent = sizeBytes > 0 ? Number(((usedBytes / sizeBytes) * 100).toFixed(1)) : 0;

      return {
        filesystem: d.FileSystem || "NTFS",
        totalGb,
        usedGb,
        availableGb: availGb,
        usedPercent,
        mountPoint: d.DeviceID, // e.g. "C:"
      };
    });

    // 4. Uptime
    let uptimeSeconds = 86400;
    if (payload.os?.LastBootUpTime) {
      // WMI DateTime format: "20260810143000.000000+060"
      const bootStr = payload.os.LastBootUpTime;
      const year = parseInt(bootStr.substring(0, 4), 10);
      const month = parseInt(bootStr.substring(4, 6), 10) - 1;
      const day = parseInt(bootStr.substring(6, 8), 10);
      const hour = parseInt(bootStr.substring(8, 10), 10);
      const min = parseInt(bootStr.substring(10, 12), 10);
      const sec = parseInt(bootStr.substring(12, 14), 10);
      const bootDate = new Date(Date.UTC(year, month, day, hour, min, sec));
      uptimeSeconds = Math.max(0, Math.floor((Date.now() - bootDate.getTime()) / 1000));
    }

    return {
      hostId,
      timestamp: new Date().toISOString(),
      osType: "WINDOWS",
      cpuUsagePct: Math.min(100, Math.max(0, cpuUsagePct)),
      cpuBreakdown: { userPct: cpuUsagePct, systemPct: 0, iowaitPct: 0, stealPct: 0 },
      memory: {
        totalGb: Number((totalMemKb / (1024 * 1024)).toFixed(2)),
        usedGb: Number((usedMemKb / (1024 * 1024)).toFixed(2)),
        availableGb: Number((freeMemKb / (1024 * 1024)).toFixed(2)),
        usedPercent: memUsedPct,
        swapTotalGb: 0,
        swapUsedGb: 0,
        swapUsedPercent: 0,
      },
      disks,
      loadAverage: { load1m: 0, load5m: 0, load15m: 0 },
      uptimeSeconds,
      iopsTotal: payload.diskPerf?.DiskTransfersPerSec || 0,
    };
  }
}
```

---

### 3.3 Host-to-DB Correlation Engine

#### Cross-Layer Topology Model
Each `DBInstance` in the DataPulse Sentinel data model references its underlying `hostId` (e.g. `host-linux-ora-01` or `host-win-sql-01`).

```typescript
export interface HostNode {
  id: string;
  hostname: string;
  ip: string;
  os: "LINUX" | "WINDOWS";
  osVersion: string;
  cpuCores: number;
  memoryTotalGb: number;
  zone: string;
  status: "ONLINE" | "HIGH_LOAD" | "CRITICAL" | "UNREACHABLE";
  lastMetrics: ParsedHostMetrics;
  associatedDatabaseIds: string[]; // Linked database instances
}

export interface HostToDBCorrelationReport {
  databaseId: string;
  databaseName: string;
  hostId: string;
  hostname: string;
  timestamp: string;
  correlationStatus: "HEALTHY" | "NOISY_NEIGHBOR_CPU" | "DB_WORKLOAD_CPU" | "STORAGE_IOPS_BOTTLENECK" | "OS_MEMORY_SWAPPING" | "DISK_SPACE_EXHAUSTION";
  confidenceScore: number; // 0 - 100%
  summary: string;
  remediationAdvice: string;
  evidence: {
    dbMetric: { name: string; value: number; unit: string };
    hostMetric: { name: string; value: number; unit: string };
  };
}
```

#### Correlation Diagnostic Decision Matrix

```
                                      ┌──────────────────────────────────────┐
                                      │   DATABASE LATENCY SPIKE DETECTED    │
                                      │        (queryLatencyMs > 100ms)      │
                                      └──────────────────┬───────────────────┘
                                                         │
                             ┌───────────────────────────┴───────────────────────────┐
                             ▼                                                       ▼
                [Host CPU Usage > 90%]                                  [Host CPU Usage <= 90%]
                             │                                                       │
               ┌─────────────┴─────────────┐                           ┌─────────────┴─────────────┐
               ▼                           ▼                           ▼                           ▼
       [DB CPU Usage < 40%]       [DB CPU Usage > 80%]         [Host IOWait > 20%]        [Host Swap Used > 15%]
               │                           │                           │                           │
               ▼                           ▼                           ▼                           ▼
      ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
      │ NOISY NEIGHBOR  │         │  DB QUERY STORM │         │  STORAGE / SAN  │         │   OS MEMORY     │
      │ HOST SATURATION │         │ UNINDEXED SCAN  │         │ IOPS BOTTLENECK │         │ SWAP THRASHING  │
      └─────────────────┘         └─────────────────┘         └─────────────────┘         └─────────────────┘
```

#### Diagnostic Decision Rules Engine

```typescript
export class HostDBCorrelationEngine {
  correlate(db: DBInstance, host: HostNode): HostToDBCorrelationReport | null {
    const hostMetrics = host.lastMetrics;
    if (!hostMetrics) return null;

    // Rule 1: Noisy Neighbor Host CPU Starvation
    if (hostMetrics.cpuUsagePct >= 88 && db.cpuUsage < 45 && db.queryLatencyMs > 50) {
      return {
        databaseId: db.id,
        databaseName: db.name,
        hostId: host.id,
        hostname: host.hostname,
        timestamp: new Date().toISOString(),
        correlationStatus: "NOISY_NEIGHBOR_CPU",
        confidenceScore: 92,
        summary: `Database latency (${db.queryLatencyMs}ms) is caused by non-database CPU saturation on host (${hostMetrics.cpuUsagePct}% host CPU vs ${db.cpuUsage}% DB CPU).`,
        remediationAdvice: `Inspect non-database host processes consuming CPU on ${host.hostname} using 'top -c' or WMI process viewer. Isolate database server workload.`,
        evidence: {
          dbMetric: { name: "DB_CPU", value: db.cpuUsage, unit: "%" },
          hostMetric: { name: "HOST_CPU", value: hostMetrics.cpuUsagePct, unit: "%" },
        },
      };
    }

    // Rule 2: Database Workload Overload (DB is driving host CPU)
    if (hostMetrics.cpuUsagePct >= 85 && db.cpuUsage >= 80 && db.queryLatencyMs > 50) {
      return {
        databaseId: db.id,
        databaseName: db.name,
        hostId: host.id,
        hostname: host.hostname,
        timestamp: new Date().toISOString(),
        correlationStatus: "DB_WORKLOAD_CPU",
        confidenceScore: 95,
        summary: `High database CPU consumption (${db.cpuUsage}%) is driving host CPU saturation (${hostMetrics.cpuUsagePct}%).`,
        remediationAdvice: `Analyze top active sessions and unindexed SQL statements currently executing in ${db.name}.`,
        evidence: {
          dbMetric: { name: "DB_CPU", value: db.cpuUsage, unit: "%" },
          hostMetric: { name: "HOST_CPU", value: hostMetrics.cpuUsagePct, unit: "%" },
        },
      };
    }

    // Rule 3: Storage IOPS / IOWait Bottleneck
    if (hostMetrics.cpuBreakdown.iowaitPct >= 20 || (hostMetrics.iopsTotal > 3000 && db.queryLatencyMs > 60)) {
      return {
        databaseId: db.id,
        databaseName: db.name,
        hostId: host.id,
        hostname: host.hostname,
        timestamp: new Date().toISOString(),
        correlationStatus: "STORAGE_IOPS_BOTTLENECK",
        confidenceScore: 88,
        summary: `High host I/O Wait (${hostMetrics.cpuBreakdown.iowaitPct}%) or heavy disk IOPS (${hostMetrics.iopsTotal}) is throttling database read/write throughput.`,
        remediationAdvice: `Verify storage volume IOPS limits and check for heavy WAL archiving or full table scans saturating data disk mount points.`,
        evidence: {
          dbMetric: { name: "DB_LATENCY", value: db.queryLatencyMs, unit: "ms" },
          hostMetric: { name: "HOST_IOWAIT", value: hostMetrics.cpuBreakdown.iowaitPct, unit: "%" },
        },
      };
    }

    // Rule 4: OS Memory Swapping Thrashing Buffer Pool
    if (hostMetrics.memory.swapUsedPercent >= 15 && db.bufferHitRatio < 95) {
      return {
        databaseId: db.id,
        databaseName: db.name,
        hostId: host.id,
        hostname: host.hostname,
        timestamp: new Date().toISOString(),
        correlationStatus: "OS_MEMORY_SWAPPING",
        confidenceScore: 90,
        summary: `Host OS is actively swapping memory (${hostMetrics.memory.swapUsedPercent}% swap used), evicting database buffer cache pages to disk (Buffer Hit: ${db.bufferHitRatio}%).`,
        remediationAdvice: `Adjust OS vm.swappiness (Linux) or reduce SGA/shared_buffers allocation to prevent OS-level memory pressure.`,
        evidence: {
          dbMetric: { name: "BUFFER_HIT_RATIO", value: db.bufferHitRatio, unit: "%" },
          hostMetric: { name: "HOST_SWAP_USED", value: hostMetrics.memory.swapUsedPercent, unit: "%" },
        },
      };
    }

    // Rule 5: Database Data Mount Disk Space Imminent Exhaustion
    const criticalMount = hostMetrics.disks.find((d) => d.usedPercent >= 90);
    if (criticalMount) {
      return {
        databaseId: db.id,
        databaseName: db.name,
        hostId: host.id,
        hostname: host.hostname,
        timestamp: new Date().toISOString(),
        correlationStatus: "DISK_SPACE_EXHAUSTION",
        confidenceScore: 98,
        summary: `Host filesystem mount '${criticalMount.mountPoint}' hosting database data is ${criticalMount.usedPercent}% full (${criticalMount.availableGb} GB remaining).`,
        remediationAdvice: `Extend storage volume or clean archived redo logs immediately to prevent database read-only freeze or transaction abort.`,
        evidence: {
          dbMetric: { name: "DB_DISK_FREE", value: db.diskFreeGb, unit: "GB" },
          hostMetric: { name: "MOUNT_USED_PCT", value: criticalMount.usedPercent, unit: "%" },
        },
      };
    }

    return null;
  }
}
```

---

## 4. API Endpoints & Server-Side Integration Specification

### 4.1 New Backend Endpoints in `server.ts`

| Method | Endpoint | Description | Request / Query | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/engine/status` | Central polling engine operational status, active worker counts by zone, circuit breaker states. | None | `{ status: "RUNNING", totalEndpoints: 120, zones: [...], circuitBreakers: [...] }` |
| `GET` | `/api/hosts` | List all agentless host nodes with latest parsed metrics. | `?zone=us-east-1` | `HostNode[]` |
| `GET` | `/api/hosts/:id/telemetry` | Historical sliding window metrics for a specific host. | `?range=30m` | `ParsedHostMetrics[]` |
| `POST` | `/api/hosts/test-connection` | Test SSH (Linux) or WinRM (Windows) credential and connectivity. | `{ host, port, osType, authType, credentials }` | `{ success: boolean, latencyMs: number, osVersion: string, message: string }` |
| `GET` | `/api/correlations` | Active cross-layer Host-to-DB correlation anomaly reports. | `?databaseId=db-pg-01` | `HostToDBCorrelationReport[]` |
| `GET` | `/api/stream/telemetry` | Server-Sent Events (SSE) live telemetry stream. | `?targetId=all` | SSE event stream |

---

## 5. Verification & Test Strategy

### 5.1 Test Suite Structure

```
tests/
├── polling/
│   ├── BoundedWorkerPool.test.ts        # Concurrency bounds, priority queue order, queue overflow
│   ├── CircuitBreaker.test.ts           # CLOSED -> OPEN -> HALF_OPEN state transitions, backoff & jitter
│   ├── PollingEngineScalability.test.ts # 100+ simulated endpoints load test, event loop lag, memory containment
│   └── TelemetryRingBuffer.test.ts      # Circular buffer capacity, eviction, O(1) ops
├── host-monitoring/
│   ├── LinuxHostMetricParser.test.ts    # /proc/stat CPU delta math, /proc/meminfo, df -Pk multi-line parsing
│   ├── WindowsWmiMetricParser.test.ts   # Win32_PerfFormattedData_PerfOS_Processor, Win32_LogicalDisk DriveType=3
│   └── HostDBCorrelation.test.ts        # Noisy neighbor vs unindexed query vs swap thrashing rule validation
```

### 5.2 Test Specifications

#### Test 1: 100+ Endpoints Concurrency & Scalability Load Test
- **Target**: Simulate 120 endpoints (60 DBs + 60 Hosts) distributed across 4 zones (`us-east-1`, `eu-west-1`, `ap-southeast-1`, `on-prem-dc1`).
- **Load Parameters**:
  - L1 Heartbeat tick every 5s.
  - L2 Telemetry tick every 30s.
  - Mock connection delay with randomized Gaussian latency (15ms – 80ms).
- **Assertions**:
  - `BoundedWorkerPool.stats.activeWorkers` strictly $\le 10$ per zone at all times.
  - Event loop delay measured via `perf_hooks` monitor does not exceed 40ms.
  - Total process RSS memory does not increase by more than 15MB over 100 simulated ticks.
  - Throughput exceeds 100 completed polls per second during tick spikes.

#### Test 2: Circuit Breaker Resilience & Chaos Test
- **Target**: Simulate connection drops, socket timeouts (ECONNREFUSED, ETIMEDOUT), and recovery.
- **Assertions**:
  - 1st failure: Failure counter = 1, state = `CLOSED`.
  - 2nd failure: Failure counter = 2, state = `CLOSED`.
  - 3rd failure: Trips to `OPEN`, consecutive trips = 1, cooldown calculated with jitter ($10\text{s} \pm 2.5\text{s}$).
  - Subsequent 50 calls in `OPEN` state return instantly ($< 1\,\text{ms}$) with fast-fail fallback, making 0 socket calls.
  - Timer advanced by 10s: State becomes `HALF_OPEN`.
  - Successful probe: Resets state to `CLOSED`, consecutive trips = 0.
  - Failed probe: Re-trips to `OPEN` with doubled backoff ($20\text{s} \pm 5\text{s}$).

#### Test 3: Linux SSH `/proc` Parser Verification
- **Target**: Feed raw sample strings from real Linux kernels (CentOS 7, Ubuntu 22.04, Debian 12) into `LinuxHostMetricParser`.
- **Edge cases tested**:
  - Wrapped long device names in `df -Pk` (e.g. `/dev/mapper/vg_db_data-lv_oradata01`).
  - Kernel without `MemAvailable` (verifies fallback to `MemFree + Buffers + Cached`).
  - First tick baseline initialization (returns 0% CPU without division-by-zero).
  - Second tick tick-delta arithmetic accuracy ($(\Delta \text{Active} / \Delta \text{Total}) \times 100$).
  - Missing `/proc/diskstats` fields.

#### Test 4: Windows WinRM / WMI Parser Verification
- **Target**: Feed WMI JSON / XML response objects into `WindowsWmiMetricParser`.
- **Edge cases tested**:
  - `DriveType = 3` filtering (ignores CD-ROM DriveType 5 and network shares DriveType 4).
  - WMI LastBootUpTime parsing (`20260810143000.000000+060`).
  - Conversion from KB to GB and percentage rounding.

#### Test 5: Host-to-DB Correlation Diagnostic Rules Verification
- **Target**: Verify diagnostic inference accuracy under simulated incident states:
  - Scenario A: Host CPU 95%, DB CPU 20%, Latency 150ms $\to$ Confirms `NOISY_NEIGHBOR_CPU` (Confidence > 90%).
  - Scenario B: Host CPU 92%, DB CPU 89%, Latency 210ms $\to$ Confirms `DB_WORKLOAD_CPU`.
  - Scenario C: Host Swap 35%, DB Buffer Hit 86% $\to$ Confirms `OS_MEMORY_SWAPPING`.
  - Scenario D: Host Mount `/u01` at 94% $\to$ Confirms `DISK_SPACE_EXHAUSTION`.

---

## 6. Implementation Handoff Recommendations

1. **Backend Service Modularization**:
   - Place Central Polling Engine core in `src/services/polling/` (`PollingCoordinator.ts`, `BoundedWorkerPool.ts`, `CircuitBreaker.ts`, `TelemetryRingBuffer.ts`).
   - Place Host Monitoring collectors and parsers in `src/services/host/` (`LinuxSshCollector.ts`, `WindowsWmiCollector.ts`, `HostMetricParsers.ts`, `HostDBCorrelationEngine.ts`).
2. **Frontend UI Extensions**:
   - Add Host Infrastructure view and Host-to-DB correlation cards to `src/components/dashboard/` and `src/components/databases/`.
   - Connect `DBAContext.tsx` to SSE endpoint `/api/stream/telemetry` for live backend telemetry streaming.
