## 2026-08-19T17:00:50Z

You are the Worker for Milestone 2: Scalable Centralized Polling Engine & Real-Time Live Streaming.
Working directory: /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_worker_m2/

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_sub_orch_m2/SCOPE.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/distributed-polling-engine/SKILL.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m2_1/handoff.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m2_2/handoff.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m2_3/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your Assigned Files & Implementation Scope:
1. `src/types/polling.ts`: Complete TypeScript types and interfaces for BoundedWorkerPool, CircuitBreaker, TieredScheduler, TelemetryRingBuffer, PollingEngine, and SSE streaming payloads.
2. `src/server/polling/BoundedWorkerPool.ts`: Zone-aware concurrency-bounded worker pool for 100+ endpoints with tri-bucket priority queue (Priority 3 = L1 Heartbeat > Priority 2 = L2 Telemetry > Priority 1 = L3 Deep Diagnostics), FIFO tie-breaking, priority-aware queue overflow eviction, active worker accounting, and runtime stats.
3. `src/server/polling/CircuitBreaker.ts`: Resilient `EndpointCircuitBreaker` with `CLOSED`, `OPEN`, `HALF_OPEN` state machine, exponential backoff (T_base * 2^(trips - 1)), full randomized jitter (+/- 25%), fast-failing in OPEN state (<1ms, no network I/O), single probe concurrency control in HALF_OPEN state, execution timeout wrapper, and clean recovery.
4. `src/server/polling/TelemetryRingBuffer.ts`: In-memory fixed-size circular ring buffer (capacity 60 samples per instance) with O(1) push, oldest sample eviction, bounded memory (<15MB for 100+ endpoints), toArray, latest, clear, size, and rolling statistical summaries (min, max, avg, p95).
5. `src/server/polling/TieredScheduler.ts`: 3-Tiered Cadence Coordinator (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Diagnostics 5-15m), phase offset initial jitter, start/stop/pause/resume/on-demand polling, and dynamic adaptive throttling (doubling L3 cadence when CPU > 90% or connections > 90% with 2-tick recovery hysteresis).
6. `src/server/polling/PollingEngine.ts`: Central coordinator managing zone worker pools, circuit breakers, tiered schedulers, ring buffers, collector dispatch, EventEmitter for `telemetry_delta`, `circuit_state`, `incident_fired`, and `heartbeat`, and aggregated engine stats.
7. `server.ts`: Integrate PollingEngine with Express:
   - Route `GET /api/stream/telemetry`: SSE endpoint with initial snapshot frame, live delta broadcast, circuit state updates, 15s keepalives (`:keepalive\n\n`), client query filtering (`?targetId=...&zone=...`), and clean disconnect cleanup.
   - Route `GET /api/polling/status`: Returns aggregated engine stats (`status`, `zones`, `circuitBreakers`, `ringBuffers`).
   - Start PollingEngine with initial database instances on server boot.
8. `src/context/DBAContext.tsx`: Update with live EventSource SSE client integration:
   - Connect to `/api/stream/telemetry`.
   - Handle `snapshot`, `telemetry_delta`, `circuit_state`, and `incident_fired` events to update React state.
   - Auto-reconnection with exponential backoff and jitter on drop.
   - Graceful fallback to local simulation if SSE server is unreachable or error, ensuring seamless UI experience.
9. `tests/unit/pollingEngine.test.ts`: Comprehensive unit test suite using `node:test` and `node:assert/strict` covering:
   - BoundedWorkerPool (concurrency bounds, priority queue ordering, FIFO tie-breaking, queue overflow eviction).
   - EndpointCircuitBreaker (CLOSED execution, tripping to OPEN on 3 failures, fast-failing in OPEN, HALF_OPEN cooldown transition, single probe recovery, probe failure backoff doubling, timeout wrapper).
   - TelemetryRingBuffer (fixed capacity, oldest eviction, circular wraparound, rolling stats).
   - PollingEngine & TieredScheduler (cadence dispatch, event emission, adaptive load throttling, engine stats).
