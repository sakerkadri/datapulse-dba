# Handoff Report — Explorer 2 (Milestone 1: Oracle Diagnostics & AI Integration)

## 1. Observation
- **Original Requirements**: `ORIGINAL_REQUEST.md:15` specifies: *"Track top wait classes (System I/O, Concurrency, Commit, Application), Data Guard replication lag, and integrate Oracle-specific AI diagnostic recommendations."*
- **Scope Blueprint**: `.agents/teamwork_preview_sub_orch_m1/SCOPE.md:7-8,23-24` specifies:
  - `src/diagnostics/rules/oracleRules.ts (ORCL-01 to ORCL-05)`
  - `server.ts` (Oracle poll endpoint & Gemini prompt enrichment)
  - `tests/oracleRules.test.ts`
  - F1.8 Rule Heuristics: ORCL-01 (Buffer cache < 90%), ORCL-02 (Redo switch > 6/hr), ORCL-03 (PDB CPU skew > 70%), ORCL-04 (ASM free < 15%), ORCL-05 (Data Guard lag > 60s).
- **Existing AI Backend**: `server.ts:31-116` implements `POST /api/ai/diagnose` with `@google/genai` model `gemini-3.6-flash` and a generic simulated fallback for PostgreSQL/SQL Server, but lacks Oracle telemetry structuring, multitenant context, and deterministic rule evaluation.
- **Frontend Modal Context**: `src/components/ai/AIDiagnosticModal.tsx:29-49` posts to `/api/ai/diagnose` with `{ type, query, metrics, databaseType, incidentContext }` and displays formatted markdown and copyable SQL.
- **Oracle Diagnostic Heuristics & Views**: `.agents/skills/oracle-dba-diagnostics/SKILL.md:42-142` documents Oracle dictionary views (`v$sysstat`, `v$log_history`, `v$rsrc_pdb_metric`, `v$asm_diskgroup`, `v$dataguard_stats`) and tuning strategies (`db_cache_size`, `DBMS_RESOURCE_MANAGER.UPDATE_PLAN_DIRECTIVE`, `RECOVER MANAGED STANDBY DATABASE PARALLEL`).
- **Test Infrastructure**: `TEST_INFRA.md:25-27` specifies Node.js test runner via `npx tsx --test`.

## 2. Logic Chain
1. **Rule Engine Design**:
   - Observations from `SCOPE.md` and `SKILL.md` define the 5 core Oracle failure modes.
   - We structured `src/diagnostics/rules/oracleRules.ts` with explicit mathematical functions for each rule (`evaluateBufferCache`, `evaluateRedoLogSwitching`, `evaluatePdbCpuSkew`, `evaluateAsmDiskgroupSpace`, `evaluateDataGuardLag`) and an aggregator `evaluateOracleRules`.
   - Each rule outputs structured findings: `ruleId`, `name`, `severity` (CRITICAL / WARNING / OK), `triggered`, `metricValue`, `threshold`, `unit`, `targetResource`, `summary`, `rootCause`, `impact`, `remediationSql`, and `remediationActions`.
2. **Gemini AI DBA Prompt Enrichment**:
   - Observation from `server.ts` showed prompt creation was basic string formatting.
   - We engineered `buildOracleGeminiPrompt()` to inject: (a) Oracle environment metadata (CDB vs Standalone, version, role), (b) SGA/PGA distribution, (c) Per-PDB CPU slice and session starvation metrics, (d) ASM diskgroup headroom, (e) Data Guard lag, (f) Top wait events, and (g) Triggered deterministic rule findings to guide the LLM toward precise RCA and DDL generation.
3. **Deterministic Fallback**:
   - Observation from `server.ts:36-62` showed the server needs a deterministic offline response when `GEMINI_API_KEY` is not set.
   - We engineered `buildDeterministicOracleFallback()` to directly translate the output of `evaluateOracleRules()` into a formatted multi-section report with actionable recommendations and SQL statements.
4. **Unit Test Harness**:
   - Designed comprehensive tests in `tests/oracleRules.test.ts` using `node:test` and `node:assert/strict` covering normal, boundary, warning, critical, non-CDB fallback, ASM disabled, and corrupted telemetry inputs.

## 3. Caveats
- The rules evaluate snapshot telemetry; multi-sample trend analysis (e.g. rate of change over 24h) relies on telemetry history objects (`redo.hourlyHistory`, `metricsHistory`) provided by the collector or caller.
- Non-CDB Standalone instances gracefully bypass `ORCL-03` (PDB CPU skew) and evaluate as `OK`.
- If ASM or Data Guard are not configured on an instance (`asmEnabled: false` or `dataGuard.configured: false`), `ORCL-04` and `ORCL-05` return `OK` without raising false positive alerts.

## 4. Conclusion
The design for Oracle Diagnostics Rule Engine (`src/diagnostics/rules/oracleRules.ts`), Gemini AI integration & fallback (`server.ts`), and unit tests (`tests/oracleRules.test.ts`) is fully specified, type-safe, and ready for builder implementation. All details, SQL snippets, threshold matrices, and test suites are documented in `analysis.md`.

## 5. Verification Method
1. **Source Inspection**: Inspect `src/diagnostics/rules/oracleRules.ts` and `analysis.md`.
2. **TypeScript Compilation Check**:
   ```bash
   npx tsc --noEmit
   ```
3. **Automated Unit Test Execution**:
   ```bash
   npx tsx --test tests/oracleRules.test.ts
   ```
4. **Invalidation Conditions**:
   - If `ORCL-01` fails to trigger WARNING when buffer cache hit ratio is 88.5%.
   - If `ORCL-02` fails to recommend 4GB redo logs when switch rate is > 6/hr.
   - If `ORCL-03` raises errors on non-CDB instances instead of returning OK.
   - If `/api/ai/diagnose` throws an unhandled exception when `GEMINI_API_KEY` is undefined.
