## 2026-08-19T17:13:35Z
You are the Lead Worker for Milestone 3 (Agentless Server Infrastructure Monitoring & Host-to-DB Correlation).
Your working directory is: /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_worker_m3_1/

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/TEST_INFRA.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/agentless-server-monitoring/SKILL.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/react-dba-dashboard-optimization/SKILL.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_1/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_2/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_3/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_sub_orch_m3/SCOPE.md

Your Task:
Implement, verify, and document all components for Milestone 3:
1. Types (`src/types/host.ts` and updates to `src/types/dba.ts` if needed)
2. Linux Agentless SSH Collector & Parser (`LinuxHostMetricParser.ts`, `LinuxHostCollector.ts`)
3. Windows Agentless WinRM/WMI Collector & Parser (`WindowsHostMetricParser.ts`, `WindowsHostCollector.ts`)
4. Deterministic Mock Collectors & Fixtures (`mockLinuxHostDriver.ts`, `mockWindowsHostDriver.ts`)
5. Host-to-DB Correlation Engine (`HostDBCorrelationService.ts` with 5 classifiers)
6. Frontend UI Components (`HostInfrastructureCard.tsx`, `HostCorrelationBanner.tsx`, context integration)
7. Backend API & SSE Integration (endpoints and telemetry streaming in `server.ts`)
8. Testing & Verification (unit and integration tests, 100% pass, zero tsc/build errors)
9. Deliverables (`changes.md`, `handoff.md`, notification to parent)
