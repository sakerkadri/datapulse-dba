# Milestone 3 Explorer 3 Handoff Report: Host-to-DB Correlation Engine & Server Infrastructure UI

**Agent ID:** teamwork_preview_explorer_m3_3  
**Milestone:** Milestone 3 (Agentless Server Infrastructure Monitoring & Host-to-DB Correlation)  
**Date:** 2026-08-19  
**Working Directory:** `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_3`  
**Handoff Type:** Hard Handoff (Investigation Complete)  

---

## 1. Observation

1. **Test Suite Baseline & Existing Tests**:
   - Running `npm test` executed 133 tests across 38 suites in `2133ms` with 100% passing (`pass: 133, fail: 0`).
   - `tests/integration/hostDbCorrelation.test.ts` (lines 56–203) contains the prototype `HostDBCorrelationService` implementing the 5 diagnostic rules:
     * `NOISY_NEIGHBOR_CPU`: Lines 73–87
     * `DB_QUERY_STORM`: Lines 89–111
     * `STORAGE_IOPS_BOTTLENECK`: Lines 113–131
     * `OS_MEMORY_SWAPPING`: Lines 133–146
     * `DISK_SPACE_EXHAUSTION`: Lines 148–199
   - `tests/unit/hostParsers.test.ts` (lines 60–442) contains complete unit tests and reference implementations for `LinuxHostMetricParser` (tick-delta math, `/proc/stat`, `/proc/meminfo`, `df -Pk`, `loadavg`, `diskstats`) and `WindowsWmiMetricParser` (WQL query payload parsing, memory KB-to-GB, DriveType 3 fixed disk filtering, WMI LastBootUpTime date parsing).

2. **Codebase Layout & Target Placements**:
   - `PROJECT.md` (lines 114–124) defines code layout targets:
     * Backend host services: `src/server/host/` (`HostDBCorrelationService.ts`, `LinuxHostCollector.ts`, `WindowsHostCollector.ts`, `LinuxHostMetricParser.ts`, `WindowsHostMetricParser.ts`).
     * Type definitions: `src/types/host.ts` and `src/types/dba.ts`.
     * UI components: `src/components/dashboard/HostInfrastructureCard.tsx` and `src/components/dashboard/HostCorrelationBanner.tsx`.
   - `server.ts` currently runs Express with `/api/health`, `/api/oracle/telemetry`, `/api/polling/status`, `/api/stream/telemetry` (SSE), `/api/ai/diagnose`, and `/api/notifications/test-email`.
   - `src/context/DBAContext.tsx` handles real-time SSE streaming from `/api/stream/telemetry` with automatic exponential backoff reconnection and client-side simulation fallback.

3. **Required Correlation Rules & Threshold Specifications**:
   - `NOISY_NEIGHBOR_CPU`: Host CPU $\ge 85.0\%$ and DB CPU $< 30.0\%$ (or DB/Host ratio $< 0.35$). Escalates to `critical` when Host CPU $\ge 95.0\%$.
   - `DB_QUERY_STORM`: Host CPU $\ge 80.0\%$ and DB CPU $\ge 70.0\%$ with active connections $\ge 20$, query latency $\ge 100\text{ms}$, or Oracle PDB active sessions $\ge 20$.
   - `STORAGE_IOPS_BOTTLENECK`: Host I/O util $\ge 80.0\%$, total IOPS $\ge 3000$, or `iowait` $\ge 20.0\%$, with DB latency $\ge 100\text{ms}$ or Oracle I/O wait class (`System I/O`, `User I/O`, `log file sync`, `db file sequential read`).
   - `OS_MEMORY_SWAPPING`: Host memory used $\ge 90.0\%$ or swap used $\ge 15.0\%$, with DB buffer cache hit ratio $< 90.0\%$.
   - `DISK_SPACE_EXHAUSTION`: Host disk mount used $\ge 85.0\%$ (warning) or $\ge 92.0\%$ (critical), or Oracle non-autoextensible tablespace used $\ge 90.0\%$, or Oracle ASM diskgroup free space $< 10.0\%$.

---

## 2. Logic Chain

1. **Step 1 (Unified Type System)**:
   - `HostMetricsSnapshot` and `CorrelationAlert` interfaces in `src/types/host.ts` must maintain strict compatibility with `tests/integration/hostDbCorrelation.test.ts` while providing extended properties (`confidence`, `rootCause`, `evidence: { hostMetric, dbMetric, details }`, `recommendation`).
   - By structuring the alert model with optional aliases (`remediation` and `recommendation`), both the test suite assertions and rich UI banners operate seamlessly.

2. **Step 2 (Backend Correlation Engine Service)**:
   - Moving the correlation engine into `src/server/host/HostDBCorrelationService.ts` centralizes multi-engine root cause evaluation.
   - The correlation engine directly accepts `DBInstance` (from PostgreSQL, MySQL, SQL Server, or Oracle) and `HostMetricsSnapshot` (from Linux SSH or Windows WinRM), returning deterministic `CorrelationAlert[]`.

3. **Step 3 (Backend API & SSE Live Streaming)**:
   - Exposing `GET /api/hosts`, `GET /api/hosts/:id/telemetry`, and `GET /api/correlations` in `server.ts` allows frontend components to query host states.
   - Emitting `correlation_alert` and `host_telemetry` events over the `/api/stream/telemetry` SSE pipeline ensures real-time updates reach the client dashboard without polling.

4. **Step 4 (Frontend UI & 60fps Optimization)**:
   - Constructing `HostInfrastructureCard.tsx` provides high-density visualizations for CPU, Memory, Disk partitions, and IOPS.
   - Constructing `HostCorrelationBanner.tsx` highlights cross-layer incidents with side-by-side Host vs. DB metric comparisons, confidence meters, and one-click AI diagnosis triggers.
   - Following `react-dba-dashboard-optimization` (`isAnimationActive={false}`, explicit container heights, ring buffer slicing) ensures smooth 60fps rendering without memory leaks.

---

## 3. Caveats

1. **Simulated SSH/WinRM in Testing**: In test and development environments without live SSH/WinRM daemons, deterministic mock fixtures (as tested in `hostParsers.test.ts`) are used to feed `HostMetricsSnapshot`.
2. **Oracle PDB Slicing Scope**: `DB_QUERY_STORM` specifically checks `db.engineSpecific.oracle.pdbs` when evaluating Oracle CDB instances. For non-Oracle engines, active connection count and query latency thresholds are evaluated.
3. **No Caveats** regarding rule mathematical accuracy: all 5 root cause conditions match the specifications in `SCOPE.md`, `ORIGINAL_REQUEST.md`, and `TEST_INFRA.md`.

---

## 4. Conclusion

The Host-to-DB Correlation Engine and Server Infrastructure UI specifications are fully resolved and documented in `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_3/analysis.md`. The design guarantees:
- 100% compatibility with all existing test suites.
- Complete support for all 5 root-cause classification rules.
- Multi-engine diagnostic support across PostgreSQL, MySQL, SQL Server, and Oracle.
- Robust React 19 UI widgets and real-time SSE streaming.

---

## 5. Verification Method

To independently verify this exploration and the technical contracts:

1. **Run Full Test Suite**:
   ```bash
   npm test
   ```
   *Expected result*: All 133 tests pass with exit code 0.

2. **Verify Correlation Integration Tests**:
   ```bash
   npx tsx --test tests/integration/hostDbCorrelation.test.ts
   ```
   *Expected result*: All 15 integration scenarios and boundary tests pass with 0 failures.

3. **Verify Host Parsers Unit Tests**:
   ```bash
   npx tsx --test tests/unit/hostParsers.test.ts
   ```
   *Expected result*: All 13 parser unit tests pass with 0 failures.

4. **Inspect Analysis Report**:
   ```bash
   cat /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_m3_3/analysis.md
   ```
