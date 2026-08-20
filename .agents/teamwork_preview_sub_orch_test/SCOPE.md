# Scope: Milestone 4 - E2E Test Suite & Test Infrastructure

## Architecture
- Node.js test runner via `tsx --test`
- Modular test suites structured into unit, integration, and load tiers:
  - `tests/unit/`: Opaque-box component and parser verification
  - `tests/integration/`: Cross-module correlation and pipeline telemetry verification
  - `tests/load/`: High-concurrency endpoint scaling (100+ endpoints) and circuit breaker resilience under dropped connections

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---|---|---|---|
| 1 | Oracle Metric Collection & Parsing Tests | CDB/PDB container metrics, non-CDB fallback, tablespace, SGA/PGA, AWR wait events | M4 (Unit) | Acceptance Criteria 1 |
| 2 | Polling Engine Unit Tests | Worker pool concurrency, adaptive tiered scheduling, circuit breaker state machine, lock-free ring buffer | M4 (Unit) | Acceptance Criteria 2 |
| 3 | Host Metric Parser Unit Tests | Linux `/proc/stat` CPU tick delta calculation, `/proc/meminfo`, `/proc/loadavg`, Windows WMI/WinRM disk & memory | M4 (Unit) | Acceptance Criteria 3 |
| 4 | Host-to-DB Correlation Integration Tests | OS host CPU/memory spikes correlated with Oracle top sessions and heavy wait events | M4 (Integration) | Acceptance Criteria 4 |
| 5 | High-Concurrency Load Tests | 100+ simulated endpoints across multiple zones without event loop degradation, circuit breaker backoff | M4 (Load) | Acceptance Criteria 5 |
| 6 | Test Script & Configuration | `npm test` script invoking `npx tsx --test tests/**/*.test.ts` | M4 (Infra) | Acceptance Criteria 6 |
| 7 | TEST_READY.md Publication | Detailed test execution instructions, coverage breakdown across Tiers 1-4 | M4 (Infra) | Acceptance Criteria 7 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M4.1 | Exploration & Test Architecture | Map existing codebase, collectors, engines, parsers, and interfaces | none | PLANNED |
| M4.2 | Test Suite Implementation | Implement unit, integration, load tests, test script in package.json | M4.1 | PLANNED |
| M4.3 | Verification & Auditing | Run test runner, perform review, adversarial challenge, forensic audit | M4.2 | PLANNED |
| M4.4 | Publication & Handoff | Publish TEST_READY.md and submit handoff to parent orchestrator | M4.3 | PLANNED |

## Interface Contracts
### Test Runner Interface
- Runner command: `npm test` or `npx tsx --test tests/**/*.test.ts`
- Exit Code 0 on complete pass
- Formats: Node.js standard test reporter with TAP / Spec output
