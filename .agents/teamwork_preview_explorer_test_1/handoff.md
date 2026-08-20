# Handoff Report: Oracle Metric Collection & Parsing Unit Test Architecture

**Agent**: `teamwork_preview_explorer_test_1` (Explorer 1, Milestone 4)  
**Target Milestone**: Milestone 4 (E2E Test Suite & Test Infrastructure)  
**Date**: 2026-08-19  
**Status**: Hard Handoff (Investigation Complete)  

---

## 1. Observation

1. **Test Infrastructure Specification (`TEST_INFRA.md:11-23, 25-27, 30`)**:
   - `TEST_INFRA.md:11-15`: Requires Feature 1 (Oracle SGA/PGA & Redo), Feature 2 (Oracle CDB/PDB Slicing), and Feature 3 (Oracle Wait Events & Data Guard) to have $\ge 5$ Tier 1 (Unit), $\ge 5$ Tier 2 (Boundary), Tier 3 (Integration), and Tier 4 (Load/Scenario) test cases.
   - `TEST_INFRA.md:25-27`: Test runner is Node.js built-in runner executed via `npx tsx --test tests/**/*.test.ts` or `npm test`, with exit code 0 pass semantics.
   - `TEST_INFRA.md:30`: Prescribes test location as `tests/unit/oracleCollector.test.ts` for metric parsing, CDB/PDB separation, wait classes, ASM, and Data Guard lag.

2. **Project Interfaces & Code Layout (`PROJECT.md:44-59, 125-131`)**:
   - `PROJECT.md:45-59`: Defines `IOracleCollector` (`collectL1Heartbeat`, `collectL2Telemetry`, `collectL3Capacity`) and `IOracleDriver` (`execute`/`query`, `close`).
   - `PROJECT.md:103-107`: Defines Oracle collector components under `src/server/collectors/oracle/` (`OracleCollector.ts`, `OracleDriver.ts`, `MockOracleDriver.ts`, `oracleQueries.ts`).
   - `PROJECT.md:126`: Defines test target `tests/unit/oracleCollector.test.ts`.

3. **Domain Diagnostic Heuristics & SQL Catalog (`.agents/skills/oracle-dba-diagnostics/SKILL.md:13-120`)**:
   - Lines 13-38: Multitenant PDB queries (`v$pdbs`, `v$session`, `v$sesstat`).
   - Lines 45-64: Buffer cache hit ratio formula (`(1 - (physical reads / (db block gets + consistent gets))) * 100`) and SGA dynamic components (`v$sga_dynamic_components`).
   - Lines 71-90: Real-time top wait events (`v$system_event` excluding `'Idle'`).
   - Lines 95-120: Tablespace capacity and autoextend headroom (`dba_data_files`, `dba_free_space`).
   - Lines 125-136: Blocking session lock tree inspector (`v$session.blocking_session`).

4. **Detailed Technical Design (`.agents/teamwork_preview_explorer_survey_2/analysis.md:74-396, 688-873, 878-892`)**:
   - Comprehensive query definitions across 11 metric domains: topology (`v$database`, `v$instance`), SGA (`v$sgainfo`), PGA (`v$pgastat`), redo history (`v$log_history`), ASM diskgroups (`v$asm_diskgroup`), background processes (`v$bgprocess`), PDB container metrics (`v$pdbs`, `v$rsrc_pdb_metric`), tablespaces (`cdb_data_files`, `cdb_free_space`), wait classes (`v$system_event`), and Data Guard (`v$dataguard_stats`).
   - Deterministic `MockOracleDriver` specification supporting scenario presets: `HEALTHY_CDB`, `STANDALONE_NON_CDB`, `PDB_STARVATION`, `HIGH_LOG_SWITCH`, `TABLESPACE_FULL`, `DATA_GUARD_LAG`.
   - Oracle error code translation mapping (`ORA-12541` listener down, `ORA-01017` auth failure, `ORA-00028` session killed, `ORA-01653` tablespace full, `ORA-00942` table not found, `ORA-00060` deadlock).

---

## 2. Logic Chain

1. **Step 1 (Scope & Requirement Grounding)**: Per `TEST_INFRA.md` and `PROJECT.md`, Oracle telemetry requires automated unit verification across 4 distinct testing tiers with zero external C++ binary dependencies in CI/CD.
2. **Step 2 (Driver Mocking Strategy)**: Direct reliance on live Oracle databases or binary Instant Client drivers is brittle and incompatible with headless CI environments. Thus, `MockOracleDriver` must implement `IOracleDriver` and support multi-scenario responses (`HEALTHY_CDB`, `STANDALONE_NON_CDB`, `TABLESPACE_FULL`, `DATA_GUARD_LAG`, `AUTH_FAILURE`, `CONNECTION_TIMEOUT`).
3. **Step 3 (Tier 1 Parser Validation)**: Unit tests must isolate mathematical parsing functions:
   - SGA pool bytes $\to$ MB conversion
   - Buffer Cache Hit Ratio calculation with exact floating-point rounding
   - PGA aggregate allocation and cache hit percentage
   - PDB resource metric slicing and container mapping
   - Tablespace max autoextend headroom calculation
   - Redo log switch aggregation (1h, 6h, 24h, avg)
   - ASM diskgroup redundancy and usable capacity
   - Background process PID and status matching
   - Wait classes aggregation excluding `'Idle'`
   - Data Guard formatted interval string conversion (`"+00 00:32:45"` $\to$ seconds).
4. **Step 4 (Tier 2 Boundary Verification)**: Edge cases must be explicitly guarded against:
   - Division by zero in Buffer Cache Hit Ratio (when total gets = 0)
   - 100% full tablespaces where `cdb_free_space` returns zero rows
   - Non-ASM environments where `v$asm_diskgroup` is unavailable
   - Standalone non-CDB instances where `cdb = 'NO'` and `v$pdbs` must not be queried
   - Missing or dead background processes (`spid IS NULL`).
5. **Step 5 (Tier 3 Cadence & Workflow Integration)**: The collector's tiered cadence (`collectL1Heartbeat`, `collectL2Telemetry`, `collectL3Capacity`) must be verified to ensure L1 heartbeats do not execute heavyweight dictionary queries (`CDB_DATA_FILES`, `V$ASM_DISKGROUP`), preserving sub-15ms execution.
6. **Step 6 (Tier 4 Resilience & Fault Injection)**: Error handlers must be tested against standard Oracle fault codes (`ORA-12541` timeout, `ORA-01017` authentication failure, `ORA-00028` disconnect, `ORA-01653` tablespace full, `ORA-00060` deadlock), proving the system never throws unhandled promise rejections.

---

## 3. Caveats

1. **Native Driver Verification**: These unit tests target the `OracleCollector` logic and `MockOracleDriver`. End-to-end network verification against live Oracle enterprise instances with native `node-oracledb` Thin Mode driver requires optional integration test flags when network credentials are provided.
2. **Oracle 11g Legacy Compatibility**: The query catalog is optimized for Oracle 12c, 19c, 21c, and 23ai (which support CDB/PDB multitenant views). Legacy Oracle 11g instances will always run in Non-CDB Standalone mode.
3. **Data Guard Configurations**: Standby Data Guard metrics (`V$DATAGUARD_STATS`) are only populated on Active Data Guard / Standby instances; Primary instances return 0 lag or disabled state.

---

## 4. Conclusion

The test suite architecture for `tests/unit/oracleCollector.test.ts` is fully specified and ready for implementation. It includes:
- **32 Total Test Cases** spanning Tiers 1–4:
  - **Tier 1 (12 Tests)**: Unit parsing for all 8 Oracle metric domains and CDB/PDB slicing.
  - **Tier 2 (8 Tests)**: Boundary conditions (division by zero, full tablespaces, non-ASM, standalone fallback, process failure, blocking locks).
  - **Tier 3 (6 Tests)**: Cadence isolation (L1/L2/L3), full pipeline integration, and dynamic scenario switching.
  - **Tier 4 (6 Tests)**: `ORA-XXXX` fault injection, timeouts, auth failure, and 50-iteration load test.
- **Complete Test Implementation Blueprint**: Pre-built test template using Node.js native test runner (`node:test` and `node:assert/strict`).
- **All documentation recorded in `analysis.md`**.

---

## 5. Verification Method

### Test Execution Commands
```bash
# Run the specific Oracle collector test suite
npx tsx --test tests/unit/oracleCollector.test.ts

# Run the complete test suite
npm test
```

### Key Files to Inspect
- `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_test_1/analysis.md` (Detailed technical design & test specification)
- `/home/saker/Desktop/projects_gemini/datapulse-dba/TEST_INFRA.md` (Test coverage matrix)
- `/home/saker/Desktop/projects_gemini/datapulse-dba/tests/unit/oracleCollector.test.ts` (Target test file to be created during implementation)

### Invalidation Conditions
- Test suite fails to run with `npx tsx --test`.
- `MockOracleDriver` requires external binary dependencies or live database connectivity.
- L1 Heartbeat execution takes $> 50\text{ms}$ or executes L3 tablespace dictionary queries.
