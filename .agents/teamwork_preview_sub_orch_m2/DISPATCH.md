## 2026-08-19T16:57:33Z

You are the Sub-Orchestrator for Milestone 2: Scalable Centralized Polling Engine & Real-Time Live Streaming.
Your working directory is /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_sub_orch_m2/.
Your parent is conversation ID 50765014-71a6-4b18-a2d1-d4a2bc835333.

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_3/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/distributed-polling-engine/SKILL.md

Scope:
Implement all components for Requirement R2:
1. Concurrency-Bounded Worker Pool: Location-aware/zone-partitioned worker pool for 100+ endpoints preventing socket exhaustion and event loop lag.
2. 3-Tiered Cadence Scheduler: Tiered intervals (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Capacity 5-15m) with prioritized task execution.
3. Resilient Circuit Breakers: EndpointCircuitBreaker with CLOSED, OPEN, HALF_OPEN states, exponential backoff (T_base * 2^trips), and randomized jitter (+/- 25%), fast-failing in OPEN state to prevent connection storms.
4. In-Memory Sliding Window Ring Buffer: Fixed-size circular TelemetryRingBuffer (capacity 60 samples per instance) with bounded memory (<15MB).
5. Real-Time Live Streaming Pipeline: Express Server-Sent Events (SSE) / WebSocket endpoint (/api/stream/telemetry) with client-side auto-reconnection and client integration in DBAContext.tsx.
6. Core Polling Orchestration: PollingEngine coordinating all collectors, pools, breakers, ring buffers, and streaming channels.
