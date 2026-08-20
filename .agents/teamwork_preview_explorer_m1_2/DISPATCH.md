## 2026-08-19T16:58:03Z
You are Explorer 2 for Milestone 1 (Oracle Database Monitoring).
Your working directory is /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m1_2/.
Your parent is conversation ID 72e141e9-5307-413e-9c29-6d61f1fbbcd4.

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_sub_orch_m1/SCOPE.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/oracle-dba-diagnostics/SKILL.md

Objective:
Investigate and design the Diagnostics Rule Engine and Gemini AI Integration for Oracle:
1. Rule Heuristics specification in `src/diagnostics/rules/oracleRules.ts`:
   - ORCL-01: Low Buffer Cache Hit Ratio (< 90% Warning, < 80% Critical) -> SGA DB_CACHE_SIZE sizing recommendation.
   - ORCL-02: Excessive Redo Log Switching (> 6 switches/hour Warning, > 12/hour Critical) -> Redo log group size increase recommendation (e.g. recommend 4GB redo logs).
   - ORCL-03: PDB CPU Hogging / Resource Skew (single PDB consuming > 70% CDB CPU) -> Resource Manager CDB plan / CPU shares recommendation.
   - ORCL-04: ASM Diskgroup Space Exhaustion (< 15% free Warning, < 5% free Critical) -> Diskgroup rebalance / add disk recommendation.
   - ORCL-05: Data Guard Replication Lag (> 60s Warning, > 300s Critical) -> Network bandwidth / redo apply worker review.
2. Integration with server diagnostic endpoint (`server.ts`) and Gemini prompt builder:
   - How Oracle telemetry is formatted for Gemini AI Root Cause Analysis prompts.
   - Fallback when Gemini API key is missing (deterministic rule findings).
3. Unit test design for oracleRules in `tests/oracleRules.test.ts`.

Output:
Write a comprehensive report to `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m1_2/analysis.md` and `handoff.md`.
Send a completion message back to parent when done.
