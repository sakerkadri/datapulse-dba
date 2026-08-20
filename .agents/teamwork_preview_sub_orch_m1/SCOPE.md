# Scope: Milestone 1 — Oracle Database Monitoring (CDB/PDB & Standalone)

## Architecture & Code Boundaries
- Engine Collector: `src/collectors/oracleCollector.ts` (node-oracledb Thin Mode + pure JS fallback/mock harness)
- Mock Driver & Test Harness: `src/collectors/mock/mockOracleDriver.ts` or integrated mock mode for zero C-library dependency
- Telemetry Types: `src/types/oracle.ts` & `src/types/telemetry.ts`
- Rule Engine / Diagnostics: `src/diagnostics/rules/oracleRules.ts` (ORCL-01 to ORCL-05)
- Server & API Integration: `src/server/server.ts` (Oracle poll endpoint & Gemini prompt enrichment)
- UI Dashboard Component: `src/components/dashboard/DatabaseEngineMetrics.tsx` (Oracle tab, CDB/PDB switch, SGA/PGA gauges, redo switch chart, ASM diskgroups, wait classes)
- Mock Data: `src/mock/dbaData.ts` (Oracle test instances, CDB/PDB instances)
- Unit & Verification Tests: `tests/oracleCollector.test.ts`, `tests/oracleRules.test.ts`, `tests/oracleIntegration.test.ts`

## Feature Inventory (Milestone 1)
| # | Feature | Description | Status |
|---|---------|-------------|--------|
| F1.1 | Oracle Connection & Thin Mode | Pure JS node-oracledb Thin Mode connection with fallback to deterministic MockOracleDriver | PLANNED |
| F1.2 | SGA/PGA & Memory Telemetry | Buffer Cache, Shared Pool, Large Pool, PGA allocated/used, Buffer Cache Hit Ratio calculation | PLANNED |
| F1.3 | Redo Log & Checkpoint Telemetry | Redo log switch history (hourly frequency), checkpoint lag, active log switches | PLANNED |
| F1.4 | ASM Diskgroup Metrics | Diskgroup total, free, usable capacity, redundancy mode, offline disks | PLANNED |
| F1.5 | Background Process Monitoring | Status checks for PMON, SMON, DBWR, LGWR, CKPT, MMON | PLANNED |
| F1.6 | Multitenant CDB/PDB Telemetry | CDB root vs PDB metrics: OPEN_MODE, per-PDB CPU slice via V$RSRC_PDB_METRIC, active sessions, tablespaces & autoextend headroom | PLANNED |
| F1.7 | Wait Events & Data Guard Lag | Top wait classes (System I/O, Concurrency, Commit, Application), Data Guard apply lag & transport lag | PLANNED |
| F1.8 | Rule Heuristics (ORCL-01 to ORCL-05) | ORCL-01 (Buffer cache < 90%), ORCL-02 (Redo switch > 6/hr), ORCL-03 (PDB CPU skew > 70%), ORCL-04 (ASM free < 15%), ORCL-05 (Data Guard lag > 60s) | PLANNED |
| F1.9 | Gemini AI Diagnostic Prompt | Oracle prompt builder enriching context with SGA/PGA, top wait events, PDB metrics | PLANNED |
| F1.10 | Frontend Dashboard UI | Dedicated Oracle view with CDB/PDB selector, gauges, charts, tables in DatabaseEngineMetrics.tsx | PLANNED |
| F1.11 | Mock & Live Instance Data | High-fidelity mock telemetry instances in dbaData.ts | PLANNED |
| F1.12 | Unit & Integration Tests | Comprehensive test suite validating collection, parsing, rules, and mock driver | PLANNED |

## Interface Contracts
- `OracleCollector.collect(config: DatabaseConfig): Promise<OracleTelemetry>`
- `OracleRules.evaluate(telemetry: OracleTelemetry): DiagnosticAlert[]`
- `OracleDriver`: Query interface compatible with `oracledb` Thin mode & deterministic MockDriver
