## 2026-08-19T17:10:47Z

<USER_REQUEST>
You are Explorer 3 for Milestone 3 (Agentless Server Infrastructure Monitoring & Host-to-DB Correlation).
Your working directory is: /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_3/

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/TEST_INFRA.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_3/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/agentless-server-monitoring/SKILL.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/react-dba-dashboard-optimization/SKILL.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_sub_orch_m3/SCOPE.md

Your Focus: Host-to-DB Correlation Engine (`HostDBCorrelationService`) and Frontend UI Components
1. Inspect the existing codebase structure, TypeScript configurations, backend services, collectors, types, and test patterns.
2. Investigate the Host-to-DB Correlation Engine (`HostDBCorrelationService`):
   - Correlate `HostMetricsSnapshot` with database metrics (`DBMetricsSnapshot` from PG, MySQL, Oracle, MSSQL).
   - Implement the 5 exact root cause classification rules:
     * `NOISY_NEIGHBOR_CPU`: Host CPU high (>85%) but DB CPU slice low (<30%)
     * `DB_QUERY_STORM`: Both DB CPU and Host CPU high (>80%) with high active sessions
     * `STORAGE_IOPS_BOTTLENECK`: Host disk queue/util high (>90%) with DB wait events on System I/O
     * `OS_MEMORY_SWAPPING`: Host memory swap activity high while DB buffer cache hit ratio plunges
     * `DISK_SPACE_EXHAUSTION`: Host tablespace disk mount free space <10% with autoextend enabled
   - Alert data structure: severity (CRITICAL, WARNING, INFO), rootCause, confidence, evidence object, recommendation.
3. Investigate the Server Infrastructure UI:
   - Host metrics card / widget for CPU, Memory, Disk, Network/IO.
   - Correlation alert banners and root-cause visualization in the dashboard.
   - API endpoints to fetch host metrics and correlation status.
4. Produce a detailed investigation report at `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_3/analysis.md` and write a handoff summary to `handoff.md`.
Send a completion message back when done.
</USER_REQUEST>
