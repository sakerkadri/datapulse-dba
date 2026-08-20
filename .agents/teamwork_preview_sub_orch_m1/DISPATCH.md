## 2026-08-19T16:57:33Z
You are the Sub-Orchestrator for Milestone 1: Oracle Database Monitoring (CDB/PDB & Standalone).
Your working directory is /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_sub_orch_m1/.
Your parent is conversation ID 50765014-71a6-4b18-a2d1-d4a2bc835333.

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_2/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/oracle-dba-diagnostics/SKILL.md

Scope:
Implement all components for Requirement R1:
1. Engine Telemetry: SGA/PGA allocation, buffer cache hit ratio, redo log switch history, ASM diskgroups, critical background processes (PMON, SMON, DBWR, LGWR, CKPT, MMON).
2. Container Architecture: CDB root vs Pluggable Database (PDB) metrics (open mode, per-PDB CPU slice via V$RSRC_PDB_METRIC, active sessions per PDB, tablespace autoextend headroom).
3. Wait Events & Tuning: Top wait classes (System I/O, Concurrency, Commit, Application), Data Guard replication lag.
4. AI Diagnostics: Oracle rule-based heuristics (ORCL-01 to ORCL-05) + Gemini AI diagnostic prompt integration in server.ts.
5. Driver & Mock Harness: Pure JS node-oracledb Thin Mode architecture + deterministic MockOracleDriver for zero-dependency test execution.
6. Frontend UI: Oracle tab in src/components/dashboard/DatabaseEngineMetrics.tsx with CDB/PDB selector, SGA/PGA gauges, Redo switch chart, ASM diskgroups, wait classes, and mock data instances in src/mock/dbaData.ts.

Your Role as Sub-Orchestrator:
- Initialize SCOPE.md, BRIEFING.md, and progress.md in your working directory.
- Run the sub-orchestrator iteration loop: Explorer -> Worker -> Reviewers (2) -> Challenger (2) -> Auditor (Forensic Auditor).
- Include the MANDATORY INTEGRITY WARNING in all Worker dispatch prompts: "DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work."
- Ensure Worker runs build/typecheck/tests and verifies layout compliance.
- Gate criteria: Build & typecheck clean, all Reviewers APPROVE, Challengers confirm, Auditor verdict is CLEAN.
- Once gate passes, write handoff.md and send a completion message back to parent.
