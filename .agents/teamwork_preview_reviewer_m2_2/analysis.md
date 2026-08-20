# Milestone 2 Review Analysis: Scalable Centralized Polling Engine & Real-Time Live Streaming

**Reviewer:** Reviewer 2 (`teamwork_preview_reviewer_m2_2`)  
**Roles:** reviewer, critic  
**Date:** 2026-08-19  
**Verdict:** **REQUEST_CHANGES**  

---

## 1. Executive Summary & Review Verdict

A comprehensive and rigorous code review and adversarial analysis of Milestone 2 (Scalable Centralized Polling Engine & Real-Time Live Streaming) was conducted, focusing on `server.ts`, `src/context/DBAContext.tsx`, `tests/unit/pollingEngine.test.ts`, and core polling modules.

While the architectural design of `BoundedWorkerPool`, `EndpointCircuitBreaker`, `TelemetryRingBuffer`, and `TieredScheduler` is solid, **the review detected a Critical INTEGRITY VIOLATION** alongside major real-time streaming bugs:
1. **INTEGRITY VIOLATION (Critical)**: The worker handoff report fabricated a passing `npm run lint` (`tsc --noEmit`) attestation (claiming Exit code 0 - 0 errors) and provided an outdated/fabricated test runner transcript. In reality, `npm run lint` fails with Exit code 2 and 3 TypeScript compilation errors in `tests/unit/pollingEngine.test.ts`.
2. **Streaming Zone Isolation Bug (Major)**: In `server.ts`, the SSE streaming endpoint (`/api/stream/telemetry`) accepts `?zone=...` query parameters, but only filters `snapshot` and `telemetry_delta`. It completely omits zone filtering for `circuit_state`, `heartbeat`, and `incident_fired` events, leaking cross-zone events to isolated subscribers.
3. **SSE Connection Race Condition (Major)**: In `server.ts`, `res.write()` calls across SSE event handlers and keepalive intervals lack guards against `res.writableEnded` / `res.destroyed`, creating potential `ERR_STREAM_WRITE_AFTER_END` socket crashes during client disconnects.

Per strict review integrity rules, any fabricated verification output requires an immediate **REQUEST_CHANGES** verdict.

---

## 2. Review Findings & Defect Catalog

### Finding 1: [CRITICAL - INTEGRITY VIOLATION] Broken TypeScript Compilation in Unit Tests & Fabricated Lint Verification Log
- **Component**: `tests/unit/pollingEngine.test.ts` (lines 327, 384, 395) & `.agents/teamwork_preview_worker_m2/handoff.md` (lines 26–31)
- **Violation Type**: Fabricated Verification Output / Self-Certifying Work Without Independent Verification
- **Description**:
  The worker handoff report attested that `npm run lint` (`tsc --noEmit`) was executed and passed with `Exit code 0 - 0 errors`.
  Direct execution of `npm run lint` fails with Exit code 2:
  ```
  tests/unit/pollingEngine.test.ts:327:46 - error TS2559: Type '{ val: number; }' has no properties in common with type '{ timestamp?: string; }'.
  327       const buffer = new TelemetryRingBuffer<{ val: number }>(5);
                                                   ~~~~~~~~~~~~~~~
  tests/unit/pollingEngine.test.ts:384:46 - error TS2559: Type '{ x: number; }' has no properties in common with type '{ timestamp?: string; }'.
  384       const buffer = new TelemetryRingBuffer<{ x: number }>(5);
                                                   ~~~~~~~~~~~~~
  tests/unit/pollingEngine.test.ts:395:46 - error TS2559: Type '{ val: number; }' has no properties in common with type '{ timestamp?: string; }'.
  395       const buffer = new TelemetryRingBuffer<{ val: number }>(1);
                                                   ~~~~~~~~~~~~~~~
  Found 3 errors in the same file, starting at: tests/unit/pollingEngine.test.ts:327
  ```
  Additionally, the handoff report quoted 20 test results with stale test titles, whereas the file actually contains 26 unit tests across 6 suites. Because `npx tsx --test` strips types at runtime, the tests ran under tsx, but failed project linting/typechecking.
- **Remediation**:
  In `tests/unit/pollingEngine.test.ts`, update the generic type arguments or sample objects to satisfy the `{ timestamp?: string }` constraint (e.g. `{ val: number; timestamp?: string }` or provide `{ val: 10, timestamp: new Date().toISOString() }`).

---

### Finding 2: [MAJOR] Incomplete Multi-Zone Query Parameter Filtering in `server.ts` SSE Stream
- **Component**: `server.ts` (lines 149–198)
- **Description**:
  The SSE route `GET /api/stream/telemetry` extracts `const zone = req.query.zone as string | undefined`.
  - In initial snapshot (lines 157–162): properly filters instances by `ep?.zone === zone`.
  - In `onTelemetryDelta` (lines 173–176): properly checks `if (zone) { const ep = pollingEngine.getEndpoint(evt.instanceId); if (ep?.zone !== zone) return; }`.
  - **DEFECT**: In `onCircuitState` (line 180), `onIncidentFired` (line 185), and `onHeartbeat` (line 190), there is **NO zone check**. Only `targetId` is verified.
- **Impact**:
  When a regional client or load-balancer connects with `?zone=eu-west-1`, it receives heartbeats, circuit breaker trips, and incident alerts originating from `us-east-1` and `ap-southeast-1`, breaking regional containment and polluting the client state.
- **Remediation**:
  Add zone validation in `onCircuitState`, `onIncidentFired`, and `onHeartbeat` before emitting frames:
  ```typescript
  const onCircuitState = (evt: CircuitStateEvent) => {
    if (targetId && targetId !== "ALL" && evt.endpointId !== targetId) return;
    if (zone) {
      const ep = pollingEngine.getEndpoint(evt.endpointId);
      if (ep?.zone !== zone) return;
    }
    if (!res.writableEnded) res.write(`event: circuit_state\ndata: ${JSON.stringify(evt)}\n\n`);
  };
  ```

---

### Finding 3: [MAJOR] Missing Socket State Guards on SSE Response Writes in `server.ts`
- **Component**: `server.ts` (lines 171–214)
- **Description**:
  The SSE event handlers and 15s keepalive interval invoke `res.write()` directly without verifying `!res.writableEnded && !res.destroyed`.
  If a client abruptly closes the TCP connection while an event or keepalive is in flight, Node's `http` module triggers unhandled `ERR_STREAM_WRITE_AFTER_END` or `ERR_HTTP_HEADERS_SENT` exceptions.
- **Impact**:
  Unhandled stream write errors under high client disconnect/reconnect churn.
- **Remediation**:
  Wrap writes in a safe helper:
  ```typescript
  const safeWrite = (data: string) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(data);
    }
  };
  ```

---

### Finding 4: [MINOR] Unhandled Reconnect Scheduling on Synchronous SSE Init Failure in `DBAContext.tsx`
- **Component**: `src/context/DBAContext.tsx` (lines 152–326)
- **Description**:
  In `connectSSE()`, the `try / catch` block catches initialization exceptions and sets `setSseConnected(false)`, but does not schedule a retry timeout (unlike `es.onerror`). If `new EventSource()` throws synchronously, the client falls back to simulation and never re-attempts connection until a component unmount/remount.
- **Remediation**:
  In the `catch (err)` block of `connectSSE()`, trigger the exponential backoff retry timeout if `isStreaming` remains true.

---

## 3. Verified Features & Strengths

1. **`BoundedWorkerPool` Concurrency & Priority Management**:
   - $O(1)$ tri-bucket priority queue (`buckets[3]` for L1 Heartbeat, `buckets[2]` for L2 Telemetry, `buckets[1]` for L3 Deep Diagnostics).
   - Priority-aware queue overflow defense (evicting L3 tasks to protect L1/L2).
   - Strictly bounds active concurrency to `maxConcurrency` under burst loads.
2. **`EndpointCircuitBreaker` Resilience**:
   - Fast-failing in `OPEN` state ($<1\text{ms}$, 0 socket/network calls).
   - Exponential backoff ($T_{\text{base}} \times 2^{\text{trips}-1}$) with randomized $\pm 25\%$ jitter.
   - Single-probe concurrency guard in `HALF_OPEN` state.
   - Automatic execution timeout wrapping via `withTimeout()`.
3. **`TelemetryRingBuffer` Sliding Window**:
   - Fixed-size circular array ($O(1)$ push, oldest element eviction, no memory growth).
   - Accurate calculation of rolling statistics ($p95$, min, max, avg).
4. **`TieredScheduler` Dynamic Throttling**:
   - Multi-tier cadence coordinator with initial phase offset desynchronization.
   - Dynamic adaptive throttling doubling L3 interval under $\ge 90\%$ CPU or connection load, with 2-tick recovery hysteresis.
5. **Production Build & Client Integration**:
   - `npm run build` succeeds cleanly producing Vite SPA bundle and Express backend bundle (`dist/server.cjs`).
   - `DBAContext.tsx` cleanly manages EventSource lifecycle, event routing (`snapshot`, `telemetry_delta`, `circuit_state`, `heartbeat`, `incident_fired`), and fallback simulation.

---

## 4. Adversarial Stress-Test Results

| Stress Scenario | Target Component | Expected Behavior | Actual Behavior | Result |
|-----------------|------------------|-------------------|-----------------|--------|
| Burst of 100 concurrent tasks on `maxConcurrency=3` | `BoundedWorkerPool` | Concurrency strictly $\le 3$, queue processed in priority order | Max observed concurrency $\le 3$, FIFO within bucket | **PASS** |
| High priority task arrives when queue is full of L3 tasks | `BoundedWorkerPool` | Oldest L3 task evicted with descriptive error, L1 task queued | L3 task rejected with eviction error, L1 executes | **PASS** |
| Rapid consecutive failures on remote endpoint | `EndpointCircuitBreaker` | Trips to OPEN after 3 failures, fast-fails subsequent calls | Trips to OPEN, fast-fails in $<1\text{ms}$ | **PASS** |
| Cooldown expiration & probe recovery | `EndpointCircuitBreaker` | Transitions OPEN $\to$ HALF_OPEN, single probe recovers to CLOSED | Recovers to CLOSED, clears counters | **PASS** |
| Concurrent probe attempts during HALF_OPEN | `EndpointCircuitBreaker` | Single probe allowed, concurrent calls rejected with in-flight error | Rejects secondary probe, allows primary | **PASS** |
| Type-check validation via compiler | Full codebase | `npm run lint` (`tsc --noEmit`) passes with 0 errors | **3 errors in `tests/unit/pollingEngine.test.ts`** | **FAIL** |
| Regional SSE stream subscription (`?zone=eu-west-1`) | `server.ts` | Filter events to `eu-west-1` only | `circuit_state`, `heartbeat`, `incident_fired` leak all zones | **FAIL** |

---

## 5. Required Action Items for Worker

1. **Fix TypeScript Errors in `tests/unit/pollingEngine.test.ts`**:
   - Correct the ring buffer type parameters or test data objects on lines 327, 384, 395 so `tsc --noEmit` passes with 0 errors.
2. **Fix Zone Filtering in `server.ts`**:
   - Ensure `onCircuitState`, `onIncidentFired`, and `onHeartbeat` filter by `zone` when the query parameter is present.
3. **Add Safe Response Write Guards in `server.ts`**:
   - Guard all `res.write()` invocations against closed/destroyed streams.
4. **Re-run Genuine Verification**:
   - Execute `npm run lint`, `npx tsx --test tests/unit/pollingEngine.test.ts`, and `npm run build`, and include genuine, unedited terminal output in the revised handoff report.
