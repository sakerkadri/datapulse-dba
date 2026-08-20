# Handoff Report — Codebase Architecture & Extension Survey

**Agent**: `teamwork_preview_explorer_survey_1`  
**Date**: 2026-08-19  
**Working Directory**: `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_1`  
**Report Type**: Hard Handoff (Investigation Complete)  

---

## 1. Observation

### 1.1 Project Structure and Build Setup
- **Root Directory**: `package.json` specifies `"type": "module"` with dependencies including `express` (`^4.21.2`), `react` (`^19.0.1`), `react-dom` (`^19.0.1`), `@google/genai` (`^2.4.0`), `@tailwindcss/vite` (`^4.1.14`), `lucide-react` (`^0.546.0`), `recharts` (`^3.10.1`), `jspdf` (`^4.2.1`), `html2canvas` (`^1.4.1`), `tsx` (`^4.21.0`), and `typescript` (`~5.8.2`).
- **Server Entrypoint (`server.ts`)**:
  - Express server on port 3000.
  - Endpoints: `GET /api/health` (lines 27-29), `POST /api/ai/diagnose` (lines 32-116), `POST /api/notifications/test-email` (lines 119-133).
  - Integrates Vite development server middleware (`server.ts` lines 136-141) in non-production environments.
- **Frontend Core (`src/App.tsx`, `src/context/DBAContext.tsx`)**:
  - `src/App.tsx` routes between 7 tabs: `dashboard`, `databases`, `alerts`, `logs`, `rbac`, `notifications`, `reports` (lines 29-35).
  - `src/types/dba.ts` defines `DatabaseEngine = "PostgreSQL" | "SQL Server" | "MySQL" | "Oracle"` (line 1), but `DBInstance.engineSpecific` only includes properties for PostgreSQL, SQL Server, and MySQL (lines 32-45).
  - `src/components/dashboard/DatabaseEngineMetrics.tsx` (lines 18-22, 40-79) only renders tabs and panels for `PostgreSQL`, `SQL Server`, and `MySQL`.
  - `src/context/DBAContext.tsx` simulates live telemetry via a client-side `setInterval` timer (lines 125-177). Currently, there is no backend streaming telemetry endpoint (WebSocket or SSE) or backend database/host collector active.
- **Existing Test Suite**:
  - `find_by_name` for `*test*` returned 0 results. No test files currently exist in the codebase.
  - `package.json` currently lacks a `"test"` script (only `"dev"`, `"ntfy:listen"`, `"build"`, `"start"`, `"preview"`, `"clean"`, `"lint"`).

---

## 2. Logic Chain

1. **Premise 1 (R1 Oracle Monitoring)**: `src/types/dba.ts` already has `"Oracle"` in `DatabaseEngine`, but lacks the data structures needed for Multitenant CDB/PDB monitoring (e.g. `v$pdbs`, open mode, per-PDB CPU slice, SGA/PGA distribution, ASM disk group headroom, Redo log switch rate, Top Wait events). Adding these interfaces and updating `DatabaseEngineMetrics.tsx`, `src/mock/dbaData.ts`, and `server.ts` AI diagnostics will deliver full Oracle observability with zero breaking changes to PostgreSQL/MySQL/SQL Server flows.
2. **Premise 2 (R2 Polling Engine)**: Currently, live metrics are generated client-side inside `DBAContext.tsx`. To scale to 100+ instances across distributed zones without event loop degradation or socket exhaustion, a backend polling engine with `BoundedWorkerPool` (zoned queues), `CircuitBreaker` (exponential backoff on dropped connections), `TieredScheduler` (L1 Heartbeat, L2 Telemetry, L3 Deep Capacity), `MetricSlidingBuffer` (circular buffer), and an SSE/WebSocket streaming endpoint (`GET /api/telemetry/stream`) must be established in `src/server/polling/`.
3. **Premise 3 (R3 Agentless Host Monitoring)**: Linux and Windows servers can be monitored agentlessly via consolidated SSH batch commands (`/proc/stat`, `/proc/meminfo`, `df -Pk`, `loadavg`, `diskstats`) and WinRM WMI queries (`Win32_Processor`, `Win32_OperatingSystem`, `Win32_LogicalDisk`). Implementing dedicated metric parsers (`linuxParser.ts`, `windowsParser.ts`) and a `HostDbCorrelationService.ts` will enable correlating database latency spikes with host CPU saturation, memory paging, and disk exhaustion.
4. **Premise 4 (Acceptance Criteria & Test Framework)**: Adding a test script (`"test": "npx tsx --test tests/**/*.test.ts"`) and creating test suites (`tests/oracleCollector.test.ts`, `tests/pollingEngine.test.ts`, `tests/hostMonitors.test.ts`) using Node's built-in test runner executed via `tsx` allows self-contained, fast, and automated verification of all acceptance criteria.

---

## 3. Caveats

- **Native Driver Installation**: `oracledb`, `ssh2`, and WinRM native transport libraries require system binaries / network access to live enterprise databases. The design relies on modular collector architectures with robust mock driver fallbacks to ensure automated test suites and development environments function reliably without external database infrastructure.
- **Node Modules Installation**: `node_modules` was not pre-installed in the repository. Running `npm install` or executing via `npx` with Node 20 will be required during implementation.

---

## 4. Conclusion

The DataPulse DBA Sentinel codebase has a clean modular architecture and consistent design system, making it well-suited for the R1, R2, and R3 extensions. The survey and integration blueprint in `analysis.md` provides clear file paths, TypeScript data contracts, and component mapping for downstream implementation agents.

---

## 5. Verification Method

To verify the survey findings independently:
1. Inspect the detailed architectural survey report at:
   `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_survey_1/analysis.md`
2. Verify TypeScript type definitions in `src/types/dba.ts` (confirm existing `DatabaseEngine` union and `DBInstance.engineSpecific` gaps).
3. Inspect `src/components/dashboard/DatabaseEngineMetrics.tsx` (confirm missing Oracle tab).
4. Inspect `server.ts` (confirm existing endpoints and lack of SSE telemetry streaming endpoint).
5. Verify that `ORIGINAL_REQUEST.md` requirements (R1, R2, R3) map 1:1 to the modules identified in `analysis.md`.
