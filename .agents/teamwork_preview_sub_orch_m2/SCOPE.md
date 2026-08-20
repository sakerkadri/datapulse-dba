# Scope: Milestone 2 — Scalable Centralized Polling Engine & Real-Time Live Streaming

## Architecture
- Central Polling Coordinator managing multi-zone worker pools, circuit breakers, tiered schedulers, ring buffers, and streaming event channels.
- Modular architecture under `src/server/polling/`:
  - `BoundedWorkerPool.ts`: Location-aware/zone-partitioned worker pool for 100+ endpoints with priority queuing (L1 > L2 > L3) preventing socket exhaustion and event loop lag.
  - `TieredScheduler.ts`: 3-Tiered Cadence Scheduler (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Capacity 5-15m) with adaptive load throttling.
  - `CircuitBreaker.ts`: Resilient `EndpointCircuitBreaker` with `CLOSED`, `OPEN`, `HALF_OPEN` states, exponential backoff ($T_{\text{base}} \times 2^{\text{trips}}$), and randomized jitter ($\pm 25\%$).
  - `TelemetryRingBuffer.ts`: In-memory fixed-size circular ring buffer (capacity 60 samples per instance) with bounded memory (<15MB) and rolling statistics.
  - `PollingEngine.ts`: Central polling engine coordinating all collectors, zone pools, breakers, buffers, and event emission.
- Streaming & Server Integration:
  - `server.ts`: Express SSE endpoint `GET /api/stream/telemetry` with keepalive pings and real-time delta broadcasts, plus `/api/polling/status` management route.
  - `src/context/DBAContext.tsx`: SSE client hook with automatic reconnection, state synchronization, and live telemetry updates.
- Data Models & Types:
  - `src/types/polling.ts` & `src/types/dba.ts`: Interface definitions for pools, schedulers, circuit states, telemetry samples, and streaming payloads.
- Unit & Load Verification:
  - `tests/unit/pollingEngine.test.ts`: Comprehensive test suite verifying BoundedWorkerPool, TieredScheduler, CircuitBreaker, TelemetryRingBuffer, PollingEngine, and SSE streaming pipeline.

## Feature Inventory (Milestone 2)
| # | Feature | Description | Status |
|---|---------|-------------|--------|
| F2.1 | Polling Types & Models | Complete TypeScript models in `src/types/polling.ts` (CircuitState, QueuedTask, WorkerPoolConfig, CadenceTier, TelemetrySample, StreamMessage) | PLANNED |
| F2.2 | BoundedWorkerPool | Zone-aware concurrency-bounded worker queues with L1/L2/L3 priority scheduling and queue overflow defense | PLANNED |
| F2.3 | Resilient CircuitBreaker | EndpointCircuitBreaker with CLOSED/OPEN/HALF_OPEN states, exponential backoff, jitter, fast-failing in OPEN state, and single HALF_OPEN probe | PLANNED |
| F2.4 | TelemetryRingBuffer | Fixed-capacity (60 points) circular ring buffer with $O(1)$ push, oldest-point eviction, rolling min/max/avg, and bounded memory footprint | PLANNED |
| F2.5 | TieredScheduler | 3-Tiered Cadence Coordinator (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Diagnostics 5-15m) with priority task dispatch and adaptive load throttling | PLANNED |
| F2.6 | Central PollingEngine | Master orchestrator coordinating all zone pools, circuit breakers, ring buffers, scheduled poll loops, and event emission | PLANNED |
| F2.7 | SSE Streaming Server API | `GET /api/stream/telemetry` with snapshot handshake, `telemetry_delta`, `circuit_state`, `incident_fired` events, and 15s keepalives | PLANNED |
| F2.8 | DBAContext Live SSE Client | React frontend EventSource integration in `DBAContext.tsx` with auto-reconnection, retry backoff, and live state updates | PLANNED |
| F2.9 | Comprehensive Polling Unit Tests | Unit tests in `tests/unit/pollingEngine.test.ts` covering worker pools, scheduler, circuit breaker, ring buffer, and polling coordination | PLANNED |

## Interface Contracts

### Polling Engine ↔ Collectors
```typescript
export interface IEndpointCollector {
  collectL1(instance: DBInstance): Promise<Partial<DBInstance>>;
  collectL2(instance: DBInstance): Promise<Partial<DBInstance>>;
  collectL3(instance: DBInstance): Promise<Partial<DBInstance>>;
}
```

### Polling Engine ↔ Streaming Pipeline
- **Ring Buffer Interface**:
  ```typescript
  export interface ITelemetryRingBuffer<T> {
    push(item: T): void;
    toArray(): T[];
    get latest(): T | null;
    clear(): void;
    get size(): number;
  }
  ```
- **SSE Stream Protocol**: `GET /api/stream/telemetry`
  - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
  - Event: `snapshot` -> `{ instances: DBInstance[], timestamp: string }`
  - Event: `telemetry_delta` -> `{ instanceId: string, timestamp: string, metrics: Partial<DBInstance>, tier: string }`
  - Event: `circuit_state` -> `{ endpointId: string, state: CircuitState, consecutiveFailures: number, nextAttemptTimestamp: number }`
  - Event: `incident_fired` -> `IncidentAlert`
  - Keepalive: `:keepalive\n\n` every 15 seconds
