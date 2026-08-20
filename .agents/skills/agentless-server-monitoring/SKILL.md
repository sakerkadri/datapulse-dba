---
name: agentless-server-monitoring
description: Procedures, command wrappers, parser logic, and security configurations for Agentless Linux (SSH) and Windows (WinRM/WMI) server infrastructure telemetry collection.
---

# Agentless Server Infrastructure Monitoring Skill

Use this skill when designing, implementing, or testing agentless infrastructure metric collectors for Linux (via SSH) and Windows (via WinRM/WMI) in DataPulse Sentinel.

## 1. Linux Agentless Telemetry Collection (SSH)

### Best Practice: Consolidated Single-Command Batch Sampling
To prevent process spawning overhead and latency jitter, execute a single composite command over a persistent or pooled SSH connection:

```bash
cat << 'EOF' | /bin/sh
echo "===CPU==="
cat /proc/stat | grep '^cpu '
echo "===MEM==="
cat /proc/meminfo | grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):'
echo "===DISK==="
df -Pk -x tmpfs -x devtmpfs -x overlay
echo "===LOAD==="
cat /proc/loadavg
echo "===IO==="
cat /proc/diskstats | head -n 15
EOF
```

### Parsing Metrics in TypeScript/Node.js:
1. **CPU Usage %**:
   - Sample delta of `user + nice + system` vs `total (idle + iowait + irq + ...)`.
   - $\text{CPU\%} = \frac{\Delta \text{Active}}{\Delta \text{Total}} \times 100$.
2. **Memory Usage %**:
   - Extract `MemTotal` and `MemAvailable`.
   - $\text{Used Memory} = \text{MemTotal} - \text{MemAvailable}$.
   - $\text{Memory\%} = \frac{\text{Used Memory}}{\text{MemTotal}} \times 100$.
3. **Disk Utilization**:
   - Parse `df -Pk` columns: `Filesystem 1024-blocks Used Available Capacity Mounted_on`.

---

## 2. Windows Agentless Telemetry Collection (WinRM / WMI)

### Querying WMI Classes via WS-Management / WinRM
From a Linux/Node.js backend, interact with Windows hosts over WinRM (port 5985 for HTTP or 5986 for HTTPS) using PowerShell or WS-Man WQL queries.

### 1. CPU Utilization (`Win32_Processor` or `Win32_PerfFormattedData_PerfOS_Processor`):
```sql
SELECT PercentProcessorTime, Name FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name = '_Total'
```

### 2. Physical Memory (`Win32_OperatingSystem`):
```sql
SELECT TotalVisibleMemorySize, FreePhysicalMemory FROM Win32_OperatingSystem
```
- $\text{Used Memory KB} = \text{TotalVisibleMemorySize} - \text{FreePhysicalMemory}$
- $\text{Memory\%} = \frac{\text{Used Memory KB}}{\text{TotalVisibleMemorySize}} \times 100$

### 3. Logical Disks (`Win32_LogicalDisk`):
```sql
SELECT DeviceID, Size, FreeSpace, FileSystem FROM Win32_LogicalDisk WHERE DriveType = 3
```

---

## 3. Host-to-Database Correlation Engine

When collecting host infrastructure metrics, map the server's telemetry (`hostId`, `hostname`, `ip`) to the running database instance:
- Correlate database query latency spikes with host CPU saturation or high `iowait`.
- Correlate database buffer cache evictions with host OS memory pressure / paging.
- Detect disk space exhaustion early across database data directories and log mount points.
