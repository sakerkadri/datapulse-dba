## 2026-08-19T16:54:18Z
You are teamwork_preview_explorer_survey_3.
Your working directory is /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_3/.
You are a read-only exploration agent. Do NOT modify source code.

Your mission is to explore and specify the complete technical design for R2: Scalable Centralized Polling Engine and R3: Agentless Server Infrastructure Monitoring.

Steps:
1. Read /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md.
2. Read the domain skills:
   - /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/distributed-polling-engine/SKILL.md
   - /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/skills/agentless-server-monitoring/SKILL.md
3. Investigate the technical design for:
   - Scalable Centralized Polling Engine: Concurrency-bounded worker pool for 100+ endpoints, location-aware/zone-aware scheduling, multi-tiered cadence (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Capacity 5-15m), circuit breakers with exponential backoff & jitter to prevent socket starvation and connection storms on unreachable endpoints.
   - Live Streaming Pipeline: Real-time WebSocket/SSE streaming backed by in-memory sliding window cache (e.g. ring buffer / eviction).
   - Linux Agentless Host Monitoring: Persistent SSH connection pool executing single-command batch sampling (/proc/stat, /proc/meminfo, df -Pk, loadavg) with zero agent installation.
   - Windows Agentless Host Monitoring: WinRM/WMI metric collector querying Win32_Processor, Win32_OperatingSystem, Win32_LogicalDisk.
   - Host-to-DB Correlation: Linking DB latency/spikes with underlying host CPU/memory/IO saturation.
   - Testing strategy: 100+ simulated endpoints load test, circuit breaker validation on dropped connections, SSH and WinRM/WMI metric parser verification.
4. Document all findings, algorithms, data structures, interfaces, and test strategies in /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_3/analysis.md.
5. Write your handoff report to /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_3/handoff.md and send a completion message back to the orchestrator (parent).
