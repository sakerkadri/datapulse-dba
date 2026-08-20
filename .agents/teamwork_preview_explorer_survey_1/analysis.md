# DataPulse DBA Sentinel — Codebase Architecture & Extension Survey

**Survey Agent**: `teamwork_preview_explorer_survey_1`  
**Date**: 2026-08-19  
**Target Application**: DataPulse DBA Sentinel  
**Working Directory**: `/home/saker/Desktop/projects_gemini/datapulse-dba`  

---

## 1. Executive Summary

DataPulse DBA Sentinel is a real-time database observability, incident management, and automated diagnostic cockpit built on **React 19 + TypeScript 5.8 + Vite 6.2 + Tailwind CSS v4** on the frontend, and **Node.js + Express 4.21** on the backend.

The platform currently simulates real-time telemetry across three relational engines (PostgreSQL 🐘, Microsoft SQL Server ⚡, MySQL 🐬), providing interactive metric charts (Recharts), customizable dashboard layouts, incident triage workflows, connection audit logs, RBAC controls, PDF report generation, and an AI diagnostic assistant powered by Google Gemini (`gemini-3.6-flash`).

### Mission of the Upcoming Expansion:
1. **R1: Oracle Database Monitoring (CDB / PDB & Standalone)**: Native telemetry for Oracle Database, supporting Multitenant (Container Database `CDB$ROOT` and Pluggable Databases `PDB`), standalone instances, SGA/PGA memory dynamic sizing, ASM disk groups, redo log switch rate, top wait classes/events (`v$system_event`), active session history lock tree, and Data Guard replication lag.
2. **R2: Scalable Centralized Polling Engine**: Centralized backend scheduler scaling to 100+ geographically distributed database/server endpoints with bounded worker pools, location/zone-aware queues, multi-tiered sampling cadence (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Diagnostics 5-15m), circuit breakers with exponential backoff, and SSE/WebSocket real-time streaming to the UI.
3. **R3: Agentless Server Infrastructure Monitoring**: Agentless telemetry collection for Linux (SSH single-batch command execution over `/proc/stat`, `/proc/meminfo`, `df -Pk`, `loadavg`) and Windows (WinRM/WMI querying `Win32_Processor`, `Win32_OperatingSystem`, `Win32_LogicalDisk`), paired with a **Host-to-DB Correlation Engine** to correlate database latency spikes with underlying host hardware saturation.

---

## 2. Codebase Directory Layout & Asset Inventory

```
datapulse-dba/
├── .agents/                                # Multi-agent coordination metadata & skills
│   ├── ORIGINAL_REQUEST.md                 # Product requirements specification
│   ├── skills/                             # Domain guidance skills
│   │   ├── oracle-dba-diagnostics/SKILL.md
│   │   ├── distributed-polling-engine/SKILL.md
│   │   ├── agentless-server-monitoring/SKILL.md
│   │   ├── postgres-dba-diagnostics/SKILL.md
│   │   ├── mysql-dba-diagnostics/SKILL.md
│   │   ├── sqlserver-dba-diagnostics/SKILL.md
│   │   └── react-dba-dashboard-optimization/SKILL.md
│   └── teamwork_preview_explorer_survey_1/ # This agent's working memory & reports
├── package.json                            # NPM manifests, scripts, dependencies
├── tsconfig.json                           # TypeScript compiler configuration (ES2022, bundler)
├── vite.config.ts                          # Vite config with React & TailwindCSS plugins
├── server.ts                               # Express backend, Vite middleware, Gemini AI endpoint
├── index.html                              # Web entry point
├── metadata.json                           # Workspace capability metadata
├── README.md                               # Project documentation & architecture overview
├── scripts/
│   └── ntfy-listener.ts                    # External push notification SSE bridge
└── src/
    ├── main.tsx                            # React 19 root bootstrap
    ├── App.tsx                             # Primary layout shell & tab navigation router
    ├── index.css                           # Global styling (@import "tailwindcss";)
    ├── types/
    │   └── dba.ts                          # Core TypeScript domain models and interfaces
    ├── mock/
    │   └── dbaData.ts                      # Initial seed state (DB instances, metrics, logs, users)
    ├── context/
    │   └── DBAContext.tsx                  # React Context provider, client ticker, action dispatchers
    └── components/
        ├── layout/
        │   ├── Navbar.tsx                  # Header bar, DB filter, live stream toggle, theme switcher
        │   ├── Sidebar.tsx                 # Desktop sidebar navigation with AI prompt trigger
        │   └── MobileNav.tsx               # Responsive mobile bottom navigation bar
        ├── dashboard/
        │   ├── CustomizableDashboard.tsx   # Presets, Recharts Area/Bar charts, widget layout manager
        │   ├── MetricCard.tsx              # KPI metric card with status badges and gauges
        │   └── DatabaseEngineMetrics.tsx   # Engine-specific diagnostic tabs (Postgres, MSSQL, MySQL)
        ├── databases/
        │   └── DatabaseManager.tsx         # Fleet grid, instance registration, ping test
        ├── alerts/
        │   └── ThresholdAlertsManager.tsx  # Alert rules builder & incident war room triage
        ├── logs/
        │   └── ConnectionLogsViewer.tsx    # Connection & auth log search stream
        ├── rbac/
        │   └── TeamRBACManager.tsx         # User directory & permission guard matrix
        ├── notifications/
        │   └── EmailNotificationManager.tsx# Dynamic HTML email template builder & test sender
        ├── reports/
        │   └── PDFReportGenerator.tsx      # A4 compliance PDF report generator (jsPDF + html2canvas)
        ├── ai/
        │   └── AIDiagnosticModal.tsx       # Gemini AI slow query & incident remediation modal
        └── search/
            └── GlobalSearchPalette.tsx     # Cmd+K universal search palette
```

---

## 3. Current Architecture & Component Inspection

### 3.1 Backend Architecture (`server.ts`)
- **Runtime**: Node.js v20+ with TypeScript execution (`tsx`).
- **Framework**: Express 4.21.2.
- **Middleware**: JSON parser (5MB limit), Vite development server integration via `createViteServer({ server: { middlewareMode: true }, appType: "spa" })`, static production asset fallback.
- **API Endpoints**:
  1. `GET /api/health`: Health probe returning `{ status: "ok", timestamp: ISO }`.
  2. `POST /api/ai/diagnose`: Invokes Google GenAI SDK (`@google/genai`, model `gemini-3.6-flash`) for slow query analysis and incident remediation plans. Includes deterministic mock fallback when `GEMINI_API_KEY` is not present.
  3. `POST /api/notifications/test-email`: Simulated SMTP alert dispatcher returning delivery metadata.
- **Observations on Backend State**:
  - The backend is currently thin; live telemetry is simulated client-side inside `DBAContext.tsx`.
  - There are currently no backend database connection pools, no polling worker pool, no agentless host monitors (SSH/WinRM), and no backend SSE or WebSocket streaming telemetry route.

### 3.2 Frontend Architecture (React 19 + TypeScript)
- **Framework**: React 19 (`react 19.0.1`, `react-dom 19.0.1`).
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite` 4.1.14), Dark/Light theme toggle (defaulting to Elegant Dark `#0f1115` / `#1a1d23`).
- **State Management (`src/context/DBAContext.tsx`)**:
  - Centralized React Context providing fleet state: `databases`, `selectedDbId`, `metricsHistory` (20-point sliding window), `thresholds`, `incidents`, `logs`, `users`, `currentUser`, `channels`, `emailTemplates`, `activePreset`, `theme`, `timeRange`, `refreshRate`, `isStreaming`.
  - Simulation Loop: When `isStreaming` is true, an interval runs every `refreshRate` seconds (default 3s) applying random deltas to active DBs, appending new `MetricPoint` records, and randomly generating `ConnectionLog` events.
- **Navigation & Routing (`src/App.tsx`)**:
  - Single-page application with state-based active tab switching:
    - `"dashboard"`: `CustomizableDashboard`
    - `"databases"`: `DatabaseManager`
    - `"alerts"`: `ThresholdAlertsManager`
    - `"logs"`: `ConnectionLogsViewer`
    - `"rbac"`: `TeamRBACManager`
    - `"notifications"`: `EmailNotificationManager`
    - `"reports"`: `PDFReportGenerator`
  - Global Modals: `AIDiagnosticModal` and `GlobalSearchPalette` (`Cmd+K`).

### 3.3 Existing Domain Models & Contracts (`src/types/dba.ts`)
- `DatabaseEngine`: `"PostgreSQL" | "SQL Server" | "MySQL" | "Oracle"` (Note: "Oracle" is already in the type union, but has no mock instances or UI tab).
- `DBInstance`: Core entity tracking connection status, CPU, memory, IOPS, active/max connections, query latency, slow queries, disk usage, replication lag, buffer hit ratio, deadlocks, and `engineSpecific`.
- `engineSpecific` currently contains:
  - PostgreSQL: `autovacuumRunning`, `walSizeMb`, `idleInTransaction`.
  - SQL Server: `tempDbContentionPct`, `pageLifeExpectancySec`, `batchRequestsPerSec`.
  - MySQL: `innodbBufferHitRatio`, `threadsConnected`, `tableLocksWaiting`.
- `MetricPoint`: Time-series data point for fleet Recharts rendering.
- `ThresholdRule` & `IncidentAlert`: Multi-severity alert rules and incident ticket tracker.
- `ConnectionLog`: Audit log entries.
- `User` & `UserPermission`: 4-tier RBAC matrix (`SUPER_ADMIN`, `SENIOR_DBA`, `JUNIOR_DBA`, `AUDITOR`).

---

## 4. Integration Blueprint for New Capabilities

### 4.1 R1: Oracle Database Monitoring (CDB / PDB & Standalone)

#### 1. Data Model Extension (`src/types/dba.ts`)
Add Oracle-specific telemetry interfaces:
```typescript
export interface OraclePDBMetrics {
  conId: number;
  pdbName: string;
  openMode: "READ WRITE" | "READ ONLY" | "MOUNTED" | "MIGRATE";
  restricted: boolean;
  totalSizeGb: number;
  activeSessions: number;
  cpuSecondsUsed: number;
  allocatedCpuShares?: number;
}

export interface OracleWaitEvent {
  event: string;
  waitClass: "System I/O" | "Concurrency" | "Commit" | "Application" | "Configuration" | "Other";
  totalWaits: number;
  timeWaitedSec: number;
  avgWaitMs: number;
}

export interface OracleTablespaceMetric {
  tablespaceName: string;
  totalMb: number;
  usedMb: number;
  freeMb: number;
  usedPct: number;
  autoextensible: boolean;
}

export interface OracleEngineMetrics {
  isCdb: boolean;
  cdbName?: string;
  sgaBufferCacheMb: number;
  sgaSharedPoolMb: number;
  sgaLargePoolMb: number;
  sgaJavaPoolMb: number;
  pgaAllocatedMb: number;
  pgaTargetMb: number;
  bufferCacheHitRatio: number;
  redoLogSwitchRatePerHour: number;
  lgwrLatencyMs: number;
  asmDiskGroupTotalGb: number;
  asmDiskGroupFreeGb: number;
  asmDiskGroupUsedPct: number;
  backgroundProcesses: {
    pmon: "RUNNING" | "FAILED";
    smon: "RUNNING" | "FAILED";
    dbwr: "RUNNING" | "FAILED";
    lgwr: "RUNNING" | "FAILED";
  };
  dataGuardReplicationLagSec: number;
  dataGuardStatus: "SYNCHRONIZED" | "TRANSPORT_LAG" | "APPLY_LAG" | "DISABLED";
  pdbs?: OraclePDBMetrics[];
  topWaitEvents: OracleWaitEvent[];
  tablespaces: OracleTablespaceMetric[];
}
```

#### 2. Backend Oracle Collector & Mock Driver (`src/server/collectors/oracleCollector.ts`)
- Standalone and CDB/PDB topology discovery.
- Queries against Oracle Dynamic Performance Views (`v$pdbs`, `v$session`, `v$sysstat`, `v$sga_dynamic_components`, `v$system_event`, `dba_data_files`, `dba_free_space`, `v$asm_diskgroup`, `v$dataguard_stats`).
- Fallback mock driver generating consistent simulated Oracle telemetry when `oracledb` native driver is not configured or in development mode.

#### 3. Frontend UI Integration
- Update `DatabaseEngineMetrics.tsx` to add an **Oracle** tab with:
  - CDB vs. Standalone architecture toggle.
  - Multitenant PDB grid showing `con_id`, `pdb_name`, `open_mode`, per-PDB CPU slice, and active sessions.
  - Dynamic SGA/PGA memory distribution visualizer.
  - Redo log switch rate and ASM disk group headroom gauge.
  - Top Wait Classes horizontal bar chart (`System I/O`, `Concurrency`, `Commit`, `Application`).
  - Active Session History (ASH) lock tree / blocking session inspector with `ALTER SYSTEM KILL SESSION` command generator.
- Update `src/mock/dbaData.ts` to include Oracle instances (e.g. `db-ora-cdb01` for CDB/PDB Multitenant and `db-ora-standalone02` for Standalone 19c Enterprise).
- Update `server.ts` Gemini AI prompt templates to recognize Oracle error codes (`ORA-00060` deadlock, `ORA-01653` tablespace unable to extend, `ORA-04031` shared pool memory exhaustion) and output Oracle-specific DDL (`ALTER TABLESPACE ... ADD DATAFILE`, `CREATE INDEX ...`).

---

### 4.2 R2: Scalable Centralized Polling Engine

#### 1. Concurrency Management & Worker Pools (`src/server/polling/BoundedWorkerPool.ts`)
- Concurrency-bounded queue per network zone (e.g. `us-east-dc`, `eu-west-cloud`, `apac-prod`).
- Prevents unbounded `Promise.all` socket exhaustion and event loop degradation across 100+ instances.
- Limits concurrent queries per zone (e.g., max 10 concurrent requests per zone worker pool).

#### 2. Multi-Tiered Adaptive Cadence Scheduling (`src/server/polling/TieredScheduler.ts`)
- **Tier 1 (Heartbeat: 5–10s)**: Lightweight TCP ping, instance uptime, active sessions, connection limit saturation.
- **Tier 2 (Telemetry: 30–60s)**: CPU%, Memory%, IOPS, mean query latency, buffer cache hit ratio, replication lag.
- **Tier 3 (Deep Diagnostics: 5–15m)**: Tablespace capacity, ASM disk groups, top wait events, deadlock history, configuration drift.

#### 3. Circuit Breaker & Exponential Backoff (`src/server/polling/CircuitBreaker.ts`)
- State machine: `CLOSED` (normal operation), `OPEN` (tripped after $N$ consecutive failures), `HALF_OPEN` (probe single test call).
- Protects downstream databases from connection storms during network partitions or database crashes.
- Configurable failure threshold (e.g. 3 consecutive timeouts), cooldown reset duration (e.g. 30s), and query timeout (e.g. 5s).

#### 4. In-Memory Sliding Window Buffer & Live Streaming (`src/server/polling/TelemetryStreamService.ts`)
- In-memory ring buffer (e.g. 60 historical samples per database instance).
- Server-Sent Events (SSE) or WebSocket streaming endpoint: `GET /api/telemetry/stream`.
- Broadcasts real-time metric delta packets to connected frontend clients.
- Frontend `DBAContext.tsx` subscribes via `EventSource` / `WebSocket` and seamlessly falls back to local simulation if the backend stream is disconnected.

---

### 4.3 R3: Agentless Server Infrastructure Monitoring

#### 1. Linux Infrastructure Telemetry (SSH Batch Sampling)
- **Protocol**: SSH connection pooling (using `ssh2` or command wrappers).
- **Consolidated Batch Command**: Single composite script to minimize connection overhead:
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
- **Parser (`src/server/parsers/linuxParser.ts`)**:
  - Calculates active CPU% from `/proc/stat` delta (`user + nice + system` / `total`).
  - Calculates Memory% from `(MemTotal - MemAvailable) / MemTotal * 100`.
  - Parses 1K-block filesystem capacities from `df -Pk`.
  - Parses 1m, 5m, 15m load averages from `/proc/loadavg`.

#### 2. Windows Infrastructure Telemetry (WinRM / WMI)
- **Protocol**: WinRM / WS-Management WQL queries over HTTP/HTTPS (ports 5985/5986).
- **Target Classes**:
  - CPU: `SELECT PercentProcessorTime FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name = '_Total'`
  - Memory: `SELECT TotalVisibleMemorySize, FreePhysicalMemory FROM Win32_OperatingSystem`
  - Disks: `SELECT DeviceID, Size, FreeSpace, FileSystem FROM Win32_LogicalDisk WHERE DriveType = 3`
- **Parser (`src/server/parsers/windowsParser.ts`)**:
  - Extracts processor load %, physical RAM utilization %, and drive headroom.

#### 3. Host-to-DB Correlation Engine (`src/server/correlation/HostDbCorrelationService.ts`)
- **Data Model**:
  - `HostServer`: `id`, `hostname`, `ip`, `osType` (`LINUX` | `WINDOWS`), `zone`, `cpuUsage`, `memoryUsage`, `iowaitPct`, `diskPartitions`, `loadAvg`.
  - Link in `DBInstance`: `hostId?: string`.
- **Correlation Logic**:
  - Detects if database query latency spike ($> 500\text{ms}$) coincides with host CPU saturation ($> 90\%$) or high `iowait` ($> 20\%$).
  - Detects if buffer cache hit ratio drops coincide with host OS memory pressure / paging.
  - Alerts DBAs when underlying host disks (mount point holding database data or redo logs) exceed 85% capacity.
- **Frontend Presentation**:
  - Correlated Host panel in `DatabaseEngineMetrics.tsx` and `CustomizableDashboard.tsx` displaying host vs. database metrics side-by-side with automated cross-layer diagnostic insights.

---

## 5. Testing Framework & Verification Strategy

### 5.1 Test Suites to Satisfy Acceptance Criteria

| Requirement | Acceptance Criterion | Test Suite | Scope |
| :--- | :--- | :--- | :--- |
| **R1. Oracle** | Automated tests verify Oracle metric collection and parsing for both CDB/PDB and non-CDB topologies (with mock driver fallback). | `tests/oracleCollector.test.ts` | CDB/PDB detection, SGA/PGA parser, wait events, tablespaces, mock fallback. |
| **R2. Polling** | Load test verifies concurrent polling of 100+ simulated endpoints across multiple zones without event loop degradation, verifying circuit breaker backoff upon simulated connection drops. | `tests/pollingEngine.test.ts` | 100+ endpoint concurrent scheduler, zone isolation, circuit breaker transition (CLOSED $\to$ OPEN $\to$ HALF_OPEN), ring buffer sliding window. |
| **R3. Host Mon**| Automated test suite verifies SSH (Linux) and WinRM/WMI (Windows) metric parsers for CPU, memory, and disk utilization. | `tests/hostMonitors.test.ts` | Linux `/proc/stat`, `/proc/meminfo`, `df -Pk` parser; Windows WMI parser; Host-to-DB correlation anomaly detection. |

### 5.2 Test Runner Configuration
- To ensure reliable, fast test execution without external dependencies, we can configure a test script using Node's built-in test runner (`node --test`) or `tsx --test` in `package.json`:
  ```json
  "scripts": {
    "test": "npx tsx --test tests/**/*.test.ts"
  }
  ```

---

## 6. Target Directory & Module Structure for New Modules

```
datapulse-dba/
├── src/
│   ├── types/
│   │   ├── dba.ts                          # Updated with Oracle & Host interfaces
│   │   ├── infrastructure.ts               # HostServer, HostMetricPoint, Correlation types
│   │   └── polling.ts                      # WorkerPool, CircuitBreaker, Scheduler types
│   ├── mock/
│   │   ├── dbaData.ts                      # Updated with Oracle CDB/PDB instances
│   │   └── hostData.ts                     # Mock Linux and Windows host servers
│   ├── server/
│   │   ├── collectors/
│   │   │   ├── oracleCollector.ts          # Oracle CDB/PDB & Standalone collector
│   │   │   ├── postgresCollector.ts        # Postgres collector
│   │   │   ├── mysqlCollector.ts           # MySQL collector
│   │   │   └── sqlserverCollector.ts       # SQL Server collector
│   │   ├── polling/
│   │   │   ├── BoundedWorkerPool.ts        # Location/zone-bounded concurrency pool
│   │   │   ├── CircuitBreaker.ts           # Circuit breaker state machine & backoff
│   │   │   ├── TieredScheduler.ts          # L1/L2/L3 adaptive scheduler
│   │   │   ├── MetricSlidingBuffer.ts      # Circular metric buffer
│   │   │   └── TelemetryStreamService.ts   # SSE live broadcast manager
│   │   ├── parsers/
│   │   │   ├── linuxParser.ts              # /proc/stat, /proc/meminfo, df -Pk parser
│   │   │   └── windowsParser.ts            # WMI CPU, Memory, LogicalDisk parser
│   │   ├── monitors/
│   │   │   ├── linuxSshMonitor.ts          # Linux SSH agentless collector wrapper
│   │   │   └── windowsWinrmMonitor.ts      # Windows WinRM agentless collector wrapper
│   │   └── correlation/
│   │       └── hostDbCorrelationService.ts # Host-to-DB telemetry correlation engine
│   └── components/
│       ├── dashboard/
│       │   ├── DatabaseEngineMetrics.tsx   # Updated with Oracle CDB/PDB diagnostics
│       │   └── HostInfrastructurePanel.tsx # Host-to-DB correlation and server metrics
│       └── ...
├── tests/
│   ├── oracleCollector.test.ts             # CDB/PDB & Standalone tests
│   ├── pollingEngine.test.ts               # 100+ endpoint scalability & circuit breaker tests
│   └── hostMonitors.test.ts                # Linux SSH & Windows WinRM parser tests
└── server.ts                               # Integrated with polling engine & telemetry stream
```

---

## 7. Downstream Execution Plan & Recommendations

1. **Phase 1 (Data Contracts & Core Parsers)**:
   - Extend `src/types/dba.ts` with Oracle and Host Infrastructure types.
   - Implement `src/server/parsers/linuxParser.ts` and `src/server/parsers/windowsParser.ts`.
   - Implement `src/server/collectors/oracleCollector.ts` with mock driver fallback.
2. **Phase 2 (Centralized Polling Engine & Resilience)**:
   - Implement `BoundedWorkerPool.ts`, `CircuitBreaker.ts`, `TieredScheduler.ts`, and `MetricSlidingBuffer.ts`.
   - Integrate SSE streaming route (`/api/telemetry/stream`) in `server.ts`.
   - Implement `hostDbCorrelationService.ts`.
3. **Phase 3 (Frontend Integration & Visualizations)**:
   - Update `DatabaseEngineMetrics.tsx` with comprehensive Oracle CDB/PDB, SGA/PGA, ASM, and Wait Events UI.
   - Add Host-to-DB Correlation visualizer in dashboard.
   - Update `DBAContext.tsx` with Oracle seed data and SSE stream listener.
4. **Phase 4 (Automated Testing & Verification)**:
   - Write comprehensive automated tests in `tests/` matching all 3 acceptance criteria.
   - Run `npm run test` and `npm run lint` / TypeScript check to verify clean integration.
