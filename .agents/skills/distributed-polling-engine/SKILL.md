---
name: distributed-polling-engine
description: High-concurrency polling engine design, location-aware worker pools, circuit breakers, adaptive tiered scheduling, and real-time WebSocket/SSE streaming.
---

# Scalable Distributed Polling Engine Skill

Use this skill when architecting, implementing, or tuning high-concurrency polling schedulers for large fleets of databases and host servers across distributed datacenters.

## 1. Concurrency Management & Worker Pools

### Bounded Worker Queues
- Prevent unbounded Promise concurrency (`Promise.all` across 100+ endpoints simultaneously causes socket exhaustion and event loop lag).
- Allocate worker buckets keyed by **location / network zone** (e.g. `us-east-dc`, `eu-west-cloud`, `apac-prod`).

```typescript
export class BoundedWorkerPool<TTask, TResult> {
  private queue: (() => Promise<void>)[] = [];
  private activeWorkers = 0;

  constructor(private readonly maxConcurrency: number) {}

  async run(task: () => Promise<TResult>): Promise<TResult> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.activeWorkers++;
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.activeWorkers--;
          this.next();
        }
      };

      if (this.activeWorkers < this.maxConcurrency) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  private next() {
    if (this.queue.length > 0 && this.activeWorkers < this.maxConcurrency) {
      const nextTask = this.queue.shift();
      if (nextTask) nextTask();
    }
  }
}
```

---

## 2. Multi-Tiered Adaptive Cadence Scheduling

Split metric collection into 3 distinct tiers to optimize network throughput and avoid database locking:

| Tier | Frequency | Target Metrics | Failure Action |
| :--- | :--- | :--- | :--- |
| **Tier 1 (Heartbeat)** | 5 – 10 seconds | TCP Ping, Uptime, Active Sessions, Connection saturation | Fast failover, trigger threshold alert if down for $>2$ ticks |
| **Tier 2 (Telemetry)** | 30 – 60 seconds | CPU%, Memory%, IOPS, Latency, Buffer Hit Ratio, Replication Lag | Append to sliding window time-series buffer |
| **Tier 3 (Deep Diagnostics)** | 5 – 15 minutes | Tablespace usage, ASM Diskgroups, Top Wait Events, Deadlock logs | Cache summary state |

---

## 3. Circuit Breaker & Exponential Backoff

When an endpoint becomes unreachable or encounters timeouts, avoid continuous polling:

```typescript
export enum CircuitState {
  CLOSED,   // Normal operation
  OPEN,     // Tripped; requests fail immediately without network call
  HALF_OPEN // Testing endpoint recovery
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // e.g. 3 consecutive failures
  resetTimeoutMs: number;    // e.g. 30,000ms cooldown before retry
  timeoutMs: number;         // e.g. 5,000ms max query duration
}
```

---

## 4. Sliding Window Metric Buffer & SSE/WebSocket Streaming

- Store telemetry samples in a fixed-size ring buffer per instance (e.g. 60 samples for 15-minute sliding window).
- Stream delta updates to connected frontend clients over Server-Sent Events (SSE) or WebSocket channel.
