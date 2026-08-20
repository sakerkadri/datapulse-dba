## 2026-08-19T17:10:47Z
You are Explorer 2 for Milestone 3 (Agentless Server Infrastructure Monitoring & Host-to-DB Correlation).
Your working directory is: /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_2/

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/TEST_INFRA.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_3/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/agentless-server-monitoring/SKILL.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_sub_orch_m3/SCOPE.md

Your Focus: Windows Agentless WinRM/WMI Monitoring & WindowsHostMetricParser
1. Inspect the existing codebase structure, TypeScript configurations, backend services, collectors, types, and test patterns.
2. Investigate the design of the Windows WinRM/WMI collector:
   - WQL queries targeting:
     * `Win32_PerfFormattedData_PerfOS_Processor` (PercentProcessorTime, PercentUserTime, PercentPrivilegedTime)
     * `Win32_OperatingSystem` (TotalVisibleMemorySize, FreePhysicalMemory, TotalVirtualMemorySize, FreeVirtualMemory, NumberOfProcesses)
     * `Win32_LogicalDisk WHERE DriveType = 3` (DeviceID, Size, FreeSpace, FileSystem, VolumeName)
     * `Win32_PerfFormattedData_PerfDisk_PhysicalDisk` (PercentDiskTime, CurrentDiskQueueLength, DiskReadsPerSec, DiskWritesPerSec)
   - Connection & authentication handling (HTTP/HTTPS, Basic/NTLM/Kerberos).
3. Investigate the WindowsHostMetricParser:
   - Mapping WMI raw responses to standardized `HostMetricsSnapshot` structure.
   - Formatted performance data vs raw counters.
   - Error handling, timeouts, and fallback strategies.
4. Investigate deterministic Mock WinRM collector & fixture strategy for testing without real Windows servers.
5. Produce a detailed investigation report at `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_2/analysis.md` and write a handoff summary to `handoff.md`.
Send a completion message back when done.
