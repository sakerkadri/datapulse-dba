# Project: DataPulse DBA Sentinel — Oracle, Scalable Polling & Agentless Monitoring

## Architecture
DataPulse DBA Sentinel is a multi-engine database monitoring and administration platform. This project adapts the sentinel to support:
1. **Oracle Database Monitoring (CDB/PDB & Standalone)**: SGA/PGA memory, ASM diskgroups, redo log switch frequency, background process health (PMON, SMON, DBWR, LGWR), multitenant PDB slicing/sessions/tablespace headroom, wait classes, Data Guard replication lag, and AI diagnostics.
2. **Scalable Centralized Polling Engine**: Concurrency-bounded worker pool for 100+ geographically distributed endpoints, location-aware scheduling, 3-tiered cadence (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Capacity 5-15m), resilient circuit breakers with exponential backoff & jitter, and SSE/WebSocket real-time streaming pipeline backed by an in-memory sliding window ring buffer cache.
3. **Agentless Server Infrastructure Monitoring**: Persistent SSH connection pool executing single-command batch sampling for Linux (`/proc/stat`, `/proc/meminfo`, `df -Pk`, `loadavg`, `diskstats`), WinRM/WMI queries for Windows (`Win32_Processor`, `Win32_OperatingSystem`, `Win32_LogicalDisk`), and Host-to-DB correlation engine pairing DB latency with OS saturation.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Oracle Engine Telemetry | SGA/PGA allocation, buffer cache hit ratio, redo log switch history, ASM diskgroups, background processes (PMON, SMON, DBWR, LGWR) | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Oracle Multitenant Architecture | CDB root vs PDB metrics (open mode, per-PDB CPU slice, active sessions, tablespace autoextend headroom) | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Oracle Wait Events & Data Guard | Top wait classes (System I/O, Concurrency, Commit, Application), Data Guard replication lag | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Oracle AI Diagnostics | Domain-specific diagnostic rules (ORCL-01 to ORCL-05) + Gemini AI diagnostic integration | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Oracle Driver & Mock Harness | Pure JS node-oracledb Thin Mode architecture + deterministic MockOracleDriver for zero-dependency CI | M1 | ORIGINAL_REQUEST §Acceptance Criteria |
| 6 | Oracle UI Dashboard Tab | Tabbed CDB/PDB metric visualization in DatabaseEngineMetrics.tsx | M1 | ORIGINAL_REQUEST §R1 |
| 7 | Concurrency-Bounded Worker Pool | Location-aware/zone-partitioned worker pool for 100+ endpoints preventing socket exhaustion | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Tiered Cadence Scheduler | Multi-tiered polling intervals (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Capacity 5-15m) | M2 | ORIGINAL_REQUEST §R2 |
| 9 | Circuit Breakers & Backoff | CLOSED/OPEN/HALF_OPEN states with exponential backoff & jitter to prevent socket starvation | M2 | ORIGINAL_REQUEST §R2 |
| 10 | Sliding Window Ring Buffer | Fixed-size circular telemetry cache (60 samples) with bounded memory footprint (<15MB) | M2 | ORIGINAL_REQUEST §R2 |
| 11 | Live Streaming Pipeline | Express SSE / WebSocket endpoint (`/api/stream/telemetry`) with client-side auto-reconnection | M2 | ORIGINAL_REQUEST §R2 |
| 12 | Linux Agentless Monitoring | Persistent SSH connection pool executing atomic multi-section batch sampling without agent installation | M3 | ORIGINAL_REQUEST §R3 |
| 13 | Linux Metric Parser | Parser calculating accurate CPU tick-delta percentage, memory buffers/cache, disk usage, loadavg | M3 | ORIGINAL_REQUEST §R3 |
| 14 | Windows Agentless Monitoring | WinRM / WMI WQL queries for Win32_Processor, Win32_OperatingSystem, Win32_LogicalDisk | M3 | ORIGINAL_REQUEST §R3 |
| 15 | Host-to-DB Correlation Engine | Linking database latency spikes with host CPU, memory paging, and storage IOPS saturation | M3 | ORIGINAL_REQUEST §R3 |
| 16 | Server Infrastructure UI | Host node metrics & correlation breakdown in Sentinel dashboard | M3 | ORIGINAL_REQUEST §R3 |
| 17 | Automated Oracle Test Suite | Tests verifying Oracle metric collection and parsing for CDB/PDB and standalone topologies | M4 | ORIGINAL_REQUEST §Acceptance Criteria |
| 18 | Scalability & Resilience Load Test | 100+ simulated endpoints load test across multiple zones with circuit breaker chaos validation | M4 | ORIGINAL_REQUEST §Acceptance Criteria |
| 19 | Server Monitoring Parser Test Suite | Unit tests verifying Linux SSH and Windows WinRM/WMI metric parsers | M4 | ORIGINAL_REQUEST §Acceptance Criteria |
| 20 | E2E Acceptance & Verification | 100% passing E2E test suite and final integrity verification | M5 | ORIGINAL_REQUEST §Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Oracle Database Monitoring | Types, OracleCollector, MockOracleDriver, AI diagnostics, UI Tab | none | IN_PROGRESS |
| M2 | Scalable Centralized Polling Engine | BoundedWorkerPool, TieredScheduler, CircuitBreaker, RingBuffer, SSE streaming | none | IN_PROGRESS |
| M3 | Agentless Host Infrastructure & Correlation | SSH batch sampler, WinRM collector, Linux/Win parsers, HostDbCorrelationService, UI | M1, M2 | IN_PROGRESS |
| M4 | E2E Testing Track & Test Infrastructure | Test harness, Oracle tests, 100+ endpoints load test, SSH/WinRM parser tests, TEST_READY.md | none | IN_PROGRESS |
| M5 | Final E2E Verification & Hardening | Run full test suite, verify 100% pass across all tiers, audit verification | M1, M2, M3, M4 | PLANNED |

## Interface Contracts

### Oracle Collector ↔ Polling Engine
- **Collector Interface**: `IOracleCollector`
  ```typescript
  interface IOracleCollector {
    collectL1Heartbeat(instance: DBInstance): Promise<OracleHeartbeatMetrics>;
    collectL2Telemetry(instance: DBInstance): Promise<OracleTelemetryMetrics>;
    collectL3Capacity(instance: DBInstance): Promise<OracleCapacityMetrics>;
  }
  ```
- **Driver Abstraction**: `IOracleDriver`
  ```typescript
  interface IOracleDriver {
    execute<T>(sql: string, binds?: Record<string, any>): Promise<T[]>;
    close(): Promise<void>;
  }
  ```

### Polling Engine ↔ Streaming Pipeline
- **Ring Buffer Interface**: `ITelemetryRingBuffer`
  ```typescript
  interface ITelemetryRingBuffer {
    push(item: TelemetrySample): void;
    getLatest(limit?: number): TelemetrySample[];
    getByInstanceId(instanceId: string, limit?: number): TelemetrySample[];
  }
  ```
- **SSE Stream Contract**: `GET /api/stream/telemetry`
  - Event: `telemetry` -> JSON payload `{ instanceId, timestamp, metrics, tier, hostMetrics? }`
  - Event: `circuit_state` -> JSON payload `{ endpointId, state, consecutiveFailures, nextAttemptTime }`
  - Event: `correlation_alert` -> JSON payload `{ instanceId, hostId, ruleId, severity, message, remediation }`

### Host Monitor ↔ Correlation Engine
- **Host Metric Data Contract**: `HostMetrics`
  ```typescript
  interface HostMetrics {
    hostId: string;
    osType: 'linux' | 'windows';
    cpu: { usagePercent: number; cores: number; loadAvg?: number[] };
    memory: { totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number };
    disk: Array<{ mount: string; totalBytes: number; usedBytes: number; usedPercent: number }>;
    io?: { readIops: number; writeIops: number; utilPercent: number };
    timestamp: string;
  }
  ```
- **Host-to-DB Correlation Contract**: `HostDBCorrelationService`
  ```typescript
  interface CorrelationAlert {
    ruleId: 'NOISY_NEIGHBOR_CPU' | 'DB_QUERY_STORM' | 'STORAGE_IOPS_BOTTLENECK' | 'OS_MEMORY_SWAPPING' | 'DISK_SPACE_EXHAUSTION';
    severity: 'critical' | 'warning' | 'info';
    dbInstanceId: string;
    hostId: string;
    description: string;
    remediation: string;
    timestamp: string;
  }
  ```

## Code Layout
- `src/types/dba.ts`: Unified data models, Oracle types, Host metrics, Polling types.
- `src/server/collectors/oracle/`:
  - `OracleCollector.ts`: Main collector implementing L1, L2, L3 sampling.
  - `OracleDriver.ts`: Thin mode driver wrapper.
  - `MockOracleDriver.ts`: Deterministic mock driver for CDB/PDB and standalone instances.
  - `oracleQueries.ts`: SQL query catalog.
- `src/server/polling/`:
  - `BoundedWorkerPool.ts`: Zone-aware concurrency-bounded worker queues.
  - `TieredScheduler.ts`: L1, L2, L3 cadence coordinator.
  - `CircuitBreaker.ts`: Resilient circuit breaker with exponential backoff & jitter.
  - `TelemetryRingBuffer.ts`: In-memory sliding window cache.
  - `PollingEngine.ts`: Central polling coordinator.
- `src/server/host/`:
  - `LinuxHostCollector.ts`: SSH persistent connection pool & batch command runner.
  - `LinuxHostMetricParser.ts`: Tick-delta CPU and OS metric parser.
  - `WindowsHostCollector.ts`: WinRM/WMI collector.
  - `WindowsHostMetricParser.ts`: WMI class parser.
  - `HostDBCorrelationService.ts`: Cross-layer anomaly correlation engine.
- `src/server/ai/oracleDiagnostics.ts`: Oracle rule-based heuristic engine + Gemini AI diagnostic prompts.
- `src/components/dashboard/`:
  - `DatabaseEngineMetrics.tsx`: Updated with Oracle CDB/PDB tab and metric widgets.
  - `HostInfrastructureCard.tsx`: Host telemetry and correlation alerts component.
- `server.ts`: Backend Express integration (routes `/api/stream/telemetry`, `/api/polling/status`, etc.).
- `tests/`:
  - `unit/oracleCollector.test.ts`: Oracle metrics & CDB/PDB parsing tests.
  - `unit/pollingEngine.test.ts`: Worker pool, scheduler, and circuit breaker unit tests.
  - `unit/hostParsers.test.ts`: Linux SSH & Windows WinRM metric parser unit tests.
  - `load/pollingLoad.test.ts`: 100+ endpoints load test across zones with circuit breaker chaos validation.
  - `integration/hostDbCorrelation.test.ts`: Host-to-DB correlation integration tests.
