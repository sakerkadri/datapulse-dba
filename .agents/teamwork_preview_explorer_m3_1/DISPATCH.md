## 2026-08-19T17:10:47Z
You are Explorer 1 for Milestone 3 (Agentless Server Infrastructure Monitoring & Host-to-DB Correlation).
Your working directory is: /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_1/

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/TEST_INFRA.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_3/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/agentless-server-monitoring/SKILL.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_sub_orch_m3/SCOPE.md

Your Focus: Linux Agentless SSH Monitoring & LinuxHostMetricParser
1. Inspect the existing codebase structure, TypeScript configurations, backend services, collectors, types, and test patterns.
2. Investigate the design of the Linux SSH collector:
   - Single atomic batch command execution over SSH (combining /proc/stat, /proc/meminfo, df -Pk, /proc/loadavg, /proc/diskstats with clear section delimiters).
   - Connection pool management with credential handling (SSH key / password / passphrase).
3. Investigate the LinuxHostMetricParser:
   - Exact CPU tick delta calculation:
     * active = user + nice + system + irq + softirq + steal
     * idle = idle + iowait
     * total = active + idle
     * deltaActive = active_current - active_prev
     * deltaTotal = total_current - total_prev
     * cpuPercent = (deltaActive / deltaTotal) * 100
   - Memory breakdown: MemTotal, MemFree, MemAvailable, Buffers, Cached, SwapTotal, SwapFree, SwapCached.
   - Filesystem parsing from df -Pk (mount point, total, used, available, pct_used).
   - Load average parsing (1m, 5m, 15m, runnable/total processes).
   - Diskstats parsing (read I/O, write I/O, sectors read/written, time doing I/O).
4. Investigate deterministic Mock SSH collector & fixture strategy for testing without real SSH servers.
5. Produce a detailed investigation report at `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_1/analysis.md` and write a handoff summary to `handoff.md`.
Send a completion message back when done.
