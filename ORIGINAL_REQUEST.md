# Original User Request

## 2026-08-19T16:53:14Z

Adapt the DataPulse DBA Sentinel application to support Oracle database monitoring (CDB/PDB multitenant and standalone architectures), a resilient centralized polling engine for 100+ geographically distributed instances, and agentless host monitoring for Windows (via WinRM/WMI) and Linux (via SSH).

Working directory: /home/saker/Desktop/projects_gemini/datapulse-dba
Integrity mode: development

## Requirements

### R1. Oracle Database Monitoring (CDB / PDB & Standalone)
- **Engine Telemetry**: Track global SGA/PGA memory allocation, Redo log switch rates, ASM diskgroup usage/headroom, and background process status (`PMON`, `SMON`, `DBWR`, `LGWR`).
- **Container Architecture**: Support CDB root vs. Pluggable Database (PDB) metrics (open mode, per-PDB CPU slice, active sessions, tablespace autoextend headroom).
- **Wait Events & Tuning**: Track top wait classes (`System I/O`, `Concurrency`, `Commit`, `Application`), Data Guard replication lag, and integrate Oracle-specific AI diagnostic recommendations.

### R2. Scalable Centralized Polling Engine
- **Worker Pool & Tiered Cadence**: Implement a concurrency-bounded polling engine with location-aware scheduling and multi-tiered intervals (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Capacity 5-15m).
- **Circuit Breakers & Resilience**: Implement exponential backoff and circuit breakers to prevent socket starvation and connection storms on unreachable endpoints.
- **Live Streaming Pipeline**: Stream real-time polling telemetry from the backend to the UI via WebSocket/SSE backed by an in-memory sliding window cache.

### R3. Agentless Server Infrastructure Monitoring
- **Linux Targets (SSH)**: Persistent SSH connection pool executing single-command batch sampling (`/proc/stat`, `/proc/meminfo`, `df -Pk`, `loadavg`) without agent installation.
- **Windows Targets (WinRM / WMI)**: Query WMI classes via WinRM (`Win32_Processor`, `Win32_OperatingSystem`, `Win32_LogicalDisk`) to collect CPU, memory, and disk metrics.
- **Host-to-DB Correlation**: Pair database instances with their underlying host server metrics to correlate DB latency with OS-level hardware saturation.

## Acceptance Criteria

### Oracle Monitoring Verification
- [ ] Automated tests verify Oracle metric collection and parsing for both CDB/PDB and non-CDB topologies (with mock driver fallback).

### Polling Engine Scalability & Resilience
- [ ] Load test verifies concurrent polling of 100+ simulated endpoints across multiple zones without event loop degradation, verifying circuit breaker backoff upon simulated connection drops.

### Server Monitoring Wrappers
- [ ] Automated test suite verifies SSH (Linux) and WinRM/WMI (Windows) metric parsers for CPU, memory, and disk utilization.
