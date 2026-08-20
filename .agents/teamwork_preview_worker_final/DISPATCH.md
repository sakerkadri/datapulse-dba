## 2026-08-19T21:07:53Z

You are teamwork_preview_worker_final.
Your working directory is /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_worker_final/.

Mandatory Reference Files:
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/ORIGINAL_REQUEST.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/PROJECT.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/TEST_INFRA.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_final_1/analysis.md
- /home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_final_1/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A forensic auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your Tasks:
1. Fix the type error in src/services/correlation/HostDBCorrelationService.ts line 50 (change `db.engineSpecific?.mysql?.innodbBufferHitRatio` to `db.engineSpecific?.innodbBufferHitRatio`).
2. Fix the import path in tests/load/m1_challenger_stress.test.ts line 18 (`import { OracleTelemetryInput } from "../../src/diagnostics/rules/oracleRules"` and `import { OracleEngineMetrics } from "../../src/types/oracle"`).
3. Fix the mock query override order in tests/unit/oracleChallengerAdversarial.test.ts (in test 3.2, ensure "V$PDBS" override is registered before "V$RSRC_PDB_METRIC" or vice versa so that ORACLE_QUERIES.PDB_RESOURCE_METRICS matches the correct mock dataset).
4. Update package.json scripts to include:
   `"test": "npx tsx --test tests/unit/*.test.ts tests/integration/*.test.ts tests/load/*.test.ts"`
   and verify "test:unit", "test:integration", "test:load", "lint", and "build" scripts work.
5. Run `npm test` and `npm run lint` (or `npx tsc --noEmit`) and verify 100% passing tests with 0 failures and 0 type errors.
6. Write /home/saker/Desktop/projects_gemini/datapulse-dba/TEST_READY.md summarizing test suite commands and coverage.
7. Document all changes and verification outputs in your handoff report (/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_worker_final/handoff.md) and send a completion message back to parent.
