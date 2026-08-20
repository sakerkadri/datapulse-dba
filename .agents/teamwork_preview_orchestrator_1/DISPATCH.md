# DISPATCH

## 2026-08-19T16:53:43Z
You are the Project Orchestrator for adapting DataPulse DBA Sentinel. Your workspace directory is /home/saker/Desktop/projects_gemini/datapulse-dba and your agent metadata directory is /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_orchestrator_1/.

Please read the user requirements at /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md and orchestrate the full implementation, automated testing, and verification:
- R1. Oracle Database Monitoring (CDB/PDB & Standalone): SGA/PGA, Redo switch rates, ASM diskgroups, background processes (PMON, SMON, DBWR, LGWR), PDB slice/sessions/headroom, wait classes, Data Guard lag, AI diagnostics.
- R2. Scalable Centralized Polling Engine: Concurrency-bounded worker pool for 100+ endpoints, location-aware scheduling, tiered cadence (L1/L2/L3), circuit breakers with exponential backoff, WebSocket/SSE live streaming pipeline with in-memory sliding window cache.
- R3. Agentless Server Infrastructure Monitoring: Linux SSH persistent pool & batch metrics, Windows WinRM/WMI metrics, host-to-DB correlation.
- Verification & Acceptance Tests: Oracle parsing/collection tests (with mock fallback), 100+ simulated endpoints load test with circuit breaker validation, SSH/WinRM metric parser tests.

Maintain your BRIEFING.md and progress.md in your agent directory. Report your milestones and victory back to the Sentinel once all requirements and acceptance criteria are fully satisfied and verified.
