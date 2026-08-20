# Handoff Report: Milestone 2 Real-Time Live Streaming & Polling Engine Test Suite

**Agent:** teamwork_preview_explorer_m2_3  
**Role:** Explorer 3 — Real-Time Live Streaming Pipeline, Frontend SSE Client Integration & Polling Unit Test Suite  
**Date:** 2026-08-19  
**Status:** Complete Hard Handoff  

---

## 1. Observation

1. **Current Server Architecture (`server.ts`)**:
   - `server.ts` currently mounts endpoints for `/api/health`, `/api/ai/diagnose`, `/api/notifications/test-email`, and Vite dev/static middleware (lines 27–154).
   - No SSE endpoint exists at `GET /api/stream/telemetry`.
   - No Polling Engine management endpoint exists at `GET /api/polling/status`.
2. **Frontend State & Simulation (`src/context/DBAContext.tsx`)**:
   - `DBAContext.tsx` contains state for `databases`, `metricsHistory`, `thresholds`, `incidents`, `logs`, `users`, etc. (lines 84–105).
   - Real-time updates currently rely purely on an internal `setInterval` simulation tick (lines 125–213) that locally modifies CPU, connections, latency, and logs.
   - `isStreaming` (boolean) and `refreshRate` (number) are stored in state (lines 99–100) but are not yet connected to a live backend SSE stream.
3. **Types & Data Contracts (`src/types/dba.ts`)**:
   - `src/types/dba.ts` contains definitions for `DBInstance`, `MetricPoint`, `ThresholdRule`, `IncidentAlert`, `ConnectionLog`, and `User` (lines 1–184).
   - It currently lacks streaming payloads (`StreamSnapshotPayload`, `StreamTelemetryDeltaPayload`, `StreamCircuitStatePayload`) and polling engine abstractions (`CircuitState`, `QueuedTask`, `WorkerPoolStats`).
4. **Testing Infrastructure (`TEST_INFRA.md` & `package.json`)**:
   - `TEST_INFRA.md` specifies Node.js built-in test runner via `npx tsx --test` (lines 25–27).
   - `TEST_INFRA.md` lists `tests/unit/pollingEngine.test.ts` as the target unit test suite for worker pool bounding, circuit breaker backoff, ring buffer eviction, and tiered scheduling (lines 30–35).
   - `package.json` contains `"tsx": "^4.21.0"`, `"typescript": "~5.8.2"`, and `"express": "^4.21.2"`.

---

## 2. Logic Chain

1. **Streaming Pipeline Implementation**:
   - Given that `server.ts` does not yet expose SSE endpoints (Obs 1), a new route `GET /api/stream/telemetry` must be implemented using standard SSE response headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`).
   - To provide immediate initial state to newly connected frontend clients without waiting for polling ticks, the endpoint must send an initial `snapshot` frame sourced directly from the ring buffer and database cache.
   - To keep intermediary reverse proxies from terminating idle connections, periodic `:keepalive\n\n` comments must be written every 15s.
   - To prevent memory leaks, listener subscriptions on the `PollingEngine` EventEmitter must be unhooked when `req.on('close')` fires.
2. **Frontend React Integration**:
   - Given that `DBAContext.tsx` uses simulated local intervals (Obs 2), it must be upgraded to instantiate an `EventSource` connecting to `/api/stream/telemetry`.
   - The SSE client must handle four core event types:
     - `snapshot`: Hydrate `databases` and `incidents`.
     - `telemetry_delta`: Merge metric updates into target `DBInstance` and append new `MetricPoint` to `metricsHistory`.
     - `circuit_state`: Update database status (`ONLINE`, `HIGH_LOAD`, `CRITICAL`) and log the transition in `ConnectionLog`.
     - `incident_fired`: Prepend firing alerts to `incidents`.
   - If the backend stream drops or errors, exponential backoff reconnection ($T_{\text{retry}} = \min(30000, 1000 \times 2^{\text{attempts}}) + \text{jitter}$) must execute, gracefully falling back to local simulation after 3 failed attempts to ensure an uninterrupted demo experience.
3. **Unit Test Suite Design**:
   - Given the runner requirement in `TEST_INFRA.md` (Obs 4), `tests/unit/pollingEngine.test.ts` must be created using `node:test` and `node:assert/strict`.
   - The test suite must be organized into 4 distinct verification suites:
     - Suite 1: `BoundedWorkerPool` (concurrency capping $\le \text{maxConcurrency}$, priority queue dispatch $L1 > L2 > L3$, FIFO tie-breaking, queue overflow defense, stats).
     - Suite 2: `EndpointCircuitBreaker` (CLOSED execution, transition to OPEN on 3 failures, fast-fail with 0 network calls, OPEN $\to$ HALF_OPEN after cooldown, single probe recovery, probe failure exponential doubling, execution timeout).
     - Suite 3: `TelemetryRingBuffer` ($O(1)$ push, fixed capacity eviction, circular wraparound, clear, rolling min/max/avg stats).
     - Suite 4: `TieredScheduler` & `PollingEngine` (cadence triggering, event emissions, zone routing, start/stop lifecycle).

---

## 3. Caveats

1. **Mock Fallback Requirement**: In development and test environments where real database network connections are absent, collector probes should utilize lightweight synthetic responses so tests execute deterministically in $< 2000\,\text{ms}$.
2. **Browser EventSource Limitation**: Standard browser `EventSource` only supports `GET` requests and cannot set custom authorization headers natively. Query parameters (`?targetId=...&zone=...`) are used for filtering.
3. **React StrictMode in Dev**: In React 19 dev mode, `useEffect` mounts and unmounts twice. The SSE hook implementation must cleanly close the `EventSource` and abort reconnection timers during cleanup to avoid duplicate streaming connections.

---

## 4. Conclusion

The real-time streaming pipeline, frontend client, and unit test specifications are completely defined with concrete signatures, wire formats, backoff algorithms, and assertions:
- **Server**: `GET /api/stream/telemetry` & `GET /api/polling/status` in `server.ts`.
- **Frontend**: Resilient `EventSource` hook with fallback simulation in `src/context/DBAContext.tsx`.
- **Types**: Event payloads and models in `src/types/polling.ts`.
- **Unit Tests**: 20 comprehensive unit tests across 4 suites in `tests/unit/pollingEngine.test.ts`.

---

## 5. Verification Method

### Test Execution Command
```bash
npx tsx --test tests/unit/pollingEngine.test.ts
```

### Verification Checklist
1. Verify `tests/unit/pollingEngine.test.ts` executes and passes all 20 tests across the 4 suites (`BoundedWorkerPool`, `EndpointCircuitBreaker`, `TelemetryRingBuffer`, `PollingEngine`).
2. Verify TypeScript typechecking passes with zero errors:
   ```bash
   npm run lint # (npx tsc --noEmit)
   ```
3. Test SSE endpoint via curl:
   ```bash
   curl -N http://localhost:3000/api/stream/telemetry
   ```
   Confirm receipt of `event: snapshot` frame followed by periodic `event: telemetry_delta` and `:keepalive` pings.
4. Test status endpoint via curl:
   ```bash
   curl http://localhost:3000/api/polling/status
   ```
   Confirm JSON response containing `status: "RUNNING"`, `zones`, `circuitBreakers`, and `ringBuffers`.
