## 2026-08-19T17:10:15Z
You are the Sub-Orchestrator for Milestone 3: Agentless Server Infrastructure Monitoring & Host-to-DB Correlation.
Your working directory is /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_sub_orch_m3/.
Your parent is conversation ID 50765014-71a6-4b18-a2d1-d4a2bc835333.

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/TEST_INFRA.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_3/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/agentless-server-monitoring/SKILL.md

Scope:
Implement all components for Requirement R3:
1. Linux Host Monitoring (SSH): Persistent SSH connection pool executing single-command atomic batch sampling (/proc/stat, /proc/meminfo, df -Pk, /proc/loadavg, /proc/diskstats) without agent installation, and LinuxHostMetricParser with accurate CPU tick-delta calculation ((Delta Active / Delta Total) * 100).
2. Windows Host Monitoring (WinRM/WMI): WinRM / WMI WQL query collector querying Win32_PerfFormattedData_PerfOS_Processor, Win32_OperatingSystem, Win32_LogicalDisk (DriveType = 3) with WindowsHostMetricParser.
3. Host-to-DB Correlation Engine: HostDBCorrelationService implementing 5 rule-based root cause classifiers:
   - NOISY_NEIGHBOR_CPU: Host CPU high (>85%) but DB CPU slice low (<30%)
   - DB_QUERY_STORM: Both DB CPU and Host CPU high (>80%) with high active sessions
   - STORAGE_IOPS_BOTTLENECK: Host disk queue/util high (>90%) with DB wait events on System I/O
   - OS_MEMORY_SWAPPING: Host memory swap activity high while DB buffer cache hit ratio plunges
   - DISK_SPACE_EXHAUSTION: Host tablespace disk mount free space <10% with autoextend enabled
4. Server Infrastructure UI: Host infrastructure card/widgets in dashboard showing host health and correlation alerts.
5. Deterministic Mock SSH and WinRM collectors for seamless unit/integration testing.
