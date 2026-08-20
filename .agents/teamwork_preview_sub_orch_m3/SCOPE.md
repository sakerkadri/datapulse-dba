# Scope: Milestone 3 — Agentless Server Infrastructure Monitoring & Host-to-DB Correlation

## Architecture
- **Linux Agentless Collector & Parser**: SSH-based atomic batch command executor (`/proc/stat`, `/proc/meminfo`, `df -Pk`, `/proc/loadavg`, `/proc/diskstats`), CPU tick delta calculation `((Delta Active / Delta Total) * 100)`.
- **Windows Agentless Collector & Parser**: WinRM / WMI WQL query collector (`Win32_PerfFormattedData_PerfOS_Processor`, `Win32_OperatingSystem`, `Win32_LogicalDisk (DriveType=3)`).
- **Correlation Engine (`HostDBCorrelationService`)**: Rule-based root cause classifier for:
  1. `NOISY_NEIGHBOR_CPU`: Host CPU high (>85%) but DB CPU slice low (<30%)
  2. `DB_QUERY_STORM`: Both DB CPU and Host CPU high (>80%) with high active sessions
  3. `STORAGE_IOPS_BOTTLENECK`: Host disk queue/util high (>90%) with DB wait events on System I/O
  4. `OS_MEMORY_SWAPPING`: Host memory swap activity high while DB buffer cache hit ratio plunges
  5. `DISK_SPACE_EXHAUSTION`: Host tablespace disk mount free space <10% with autoextend enabled
- **Mock Collectors**: Deterministic Mock SSH and Mock WinRM collectors for seamless unit/integration testing.
- **Frontend UI Components**: Host infrastructure cards/widgets and correlation alert banners in dashboard.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Linux SSH Collector & Batching | Atomic single command execution over SSH pool | M3 | R3 |
| 2 | Linux CPU Delta & Metric Parser | Exact tick delta CPU calculation & proc parsing | M3 | R3 |
| 3 | Windows WinRM Collector & Parser | WQL query collector & parser | M3 | R3 |
| 4 | Host-to-DB Correlation Service | 5 root cause classifiers | M3 | R3 |
| 5 | Deterministic Mocks | Mock SSH/WinRM fixtures & collectors | M3 | R3 |
| 6 | Host Infrastructure UI | Dashboard cards/widgets for OS metrics & correlation | M3 | R3 |

## Interface Contracts
- `HostMetricCollector` interface: `collect(target: HostTarget): Promise<HostMetricsSnapshot>`
- `HostDBCorrelationService.correlate(hostMetrics: HostMetricsSnapshot, dbMetrics: DBMetricsSnapshot): HostCorrelationAlert[]`
- `LinuxHostMetricParser.parse(rawOutput: string, prevSnapshot?: LinuxRawSnapshot): HostMetricsSnapshot`
- `WindowsHostMetricParser.parse(wqlResult: WindowsWqlResult): HostMetricsSnapshot`

## Code Layout
- Backend Collectors & Parsers: `server/src/collectors/host/` or `server/src/services/host/`
- Correlation Service: `server/src/services/correlation/`
- Mock Collectors: `server/src/collectors/mock/` or `server/src/tests/mocks/`
- Frontend Widgets: `src/components/host/` or `src/components/infrastructure/`
- Tests: `server/src/tests/` or corresponding test paths
