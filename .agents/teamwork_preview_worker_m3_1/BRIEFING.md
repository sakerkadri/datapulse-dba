# BRIEFING — 2026-08-19T18:14:30Z

## Mission
Implement, verify, and document all components for Milestone 3 (Agentless Server Infrastructure Monitoring & Host-to-DB Correlation).

## 🔒 My Identity
- Archetype: lead_worker
- Roles: implementer, qa, specialist
- Working directory: /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_worker_m3_1/
- Original parent: 470d98f4-332d-4baf-8967-5778472e708c
- Milestone: Milestone 3 — Agentless Server Infrastructure Monitoring & Host-to-DB Correlation

## 🔒 Key Constraints
- DO NOT CHEAT. All implementations must be genuine.
- DO NOT hardcode test results or create dummy/facade implementations.
- Every implementation must maintain real state and produce real behavior.
- Strictly adhere to interface contracts and project layout.
- Verify 100% test pass and zero compilation/lint errors.

## Current Parent
- Conversation ID: 470d98f4-332d-4baf-8967-5778472e708c
- Updated: 2026-08-19T18:14:30Z

## Task Summary
- **What to build**:
  1. Types (`src/types/host.ts` and updates to `src/types/dba.ts`): Unified HostMetricsSnapshot, ParsedHostMetrics, HostTarget, CorrelationAlert, CorrelationEvidence, WindowsWqlResult, LinuxRawSnapshot, etc.
  2. Linux Agentless Collector & Parser (`LinuxHostMetricParser.ts`, `LinuxHostCollector.ts`).
  3. Windows Agentless Collector & Parser (`WindowsHostMetricParser.ts`, `WindowsHostCollector.ts`).
  4. Deterministic Mock Collectors & Fixtures (`mockLinuxHostDriver.ts`, `mockWindowsHostDriver.ts`).
  5. Host-to-DB Correlation Engine (`HostDBCorrelationService.ts` with 5 classifiers: NOISY_NEIGHBOR_CPU, DB_QUERY_STORM, STORAGE_IOPS_BOTTLENECK, OS_MEMORY_SWAPPING, DISK_SPACE_EXHAUSTION).
  6. Frontend UI Components (`HostInfrastructureCard.tsx`, `HostCorrelationBanner.tsx`, integrated with DBAContext and main dashboard).
  7. Backend REST API & SSE streaming integration in `server.ts`.
  8. Full test coverage & verification (unit and integration tests, 100% pass, zero errors).
  9. Changes report and handoff documentation.
- **Success criteria**: All collectors, parsers, correlation rules, mock drivers, frontend cards, and backend routes implemented and passing 100% test coverage with zero tsc errors.
- **Interface contracts**: `.agents/teamwork_preview_sub_orch_m3/SCOPE.md` & `PROJECT.md`
- **Code layout**: `PROJECT.md` & `SCOPE.md`

## Loaded Skills
- **Source**: `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/agentless-server-monitoring/SKILL.md`
  - **Local copy**: `.agents/skills/agentless-server-monitoring/SKILL.md`
  - **Core methodology**: Single-command batch SSH sampling, /proc parsing, CPU tick delta calculation, WinRM WQL queries, and Host-to-DB correlation.
- **Source**: `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/react-dba-dashboard-optimization/SKILL.md`
  - **Local copy**: `.agents/skills/react-dba-dashboard-optimization/SKILL.md`
  - **Core methodology**: 60fps Recharts rendering (isAnimationActive=false), fixed container heights, sliding-window ring buffers, RBAC guards.

## Change Tracker
- **Files modified**: [TBD]
- **Build status**: 133/133 tests passing baseline
- **Pending issues**: None

## Quality Status
- **Build/test result**: 133/133 pass
- **Lint status**: Zero violations
- **Tests added/modified**: Pending M3 test additions

## Artifact Index
- `.agents/teamwork_preview_worker_m3_1/DISPATCH.md` — Assignment & Requirements
- `.agents/teamwork_preview_worker_m3_1/BRIEFING.md` — Situational awareness
- `.agents/teamwork_preview_worker_m3_1/progress.md` — Execution heartbeat
