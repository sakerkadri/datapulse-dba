## 2026-08-19T16:54:18Z

Explore and specify the complete requirements and technical design for R1: Oracle Database Monitoring (CDB/PDB & Standalone).

Steps:
1. Read /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md.
2. Read the domain skill /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/oracle-dba-diagnostics/SKILL.md.
3. Investigate the required Oracle telemetry:
   - Engine Telemetry: SGA/PGA memory allocation (V$SGAINFO, V$PGASTAT), Redo log switch rates (V$LOG_HISTORY), ASM diskgroup usage/headroom (V$ASM_DISKGROUP), background processes (PMON, SMON, DBWR, LGWR via V$PROCESS/V$BGPROCESS).
   - Container Architecture: CDB root vs Pluggable Database (PDB) metrics (open mode, per-PDB CPU slice via V$RSRC_PDB_METRIC, active sessions per PDB via V$SESSION/V$CON_SYSSTAT, tablespace autoextend headroom via CDB_DATA_FILES/CDB_TABLESPACES).
   - Wait Events & Tuning: top wait classes (System I/O, Concurrency, Commit, Application), Data Guard replication lag (V$DATAGUARD_STATS/V$ARCHIVE_DEST_STATUS), AI diagnostic recommendations logic.
   - Driver & Mock Architecture: node-oracledb thin mode integration with mock fallback driver for automated unit/integration tests without a live Oracle instance.
4. Document the exact queries, data schemas, types, error handling, mock data structures, and AI diagnostic heuristics in /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_2/analysis.md.
5. Write your handoff report to /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_2/handoff.md and send a completion message back to the orchestrator (parent).
