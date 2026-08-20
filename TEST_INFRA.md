# E2E Test Infra: DataPulse DBA Sentinel

## Test Philosophy
- Requirement-driven, opaque-box, deterministic verification.
- Validates all 3 acceptance criteria:
  1. Oracle metric collection and parsing for CDB/PDB and standalone topologies (with mock driver fallback).
  2. Scalable concurrent polling of 100+ simulated endpoints across multiple zones without event loop degradation, verifying circuit breaker backoff upon simulated connection drops.
  3. Linux (SSH) and Windows (WinRM/WMI) metric parsers for CPU, memory, and disk utilization.

## Feature Inventory & Test Coverage Mapping
| # | Feature | Requirement | Tier 1 (Unit) | Tier 2 (Boundary) | Tier 3 (Integration) | Tier 4 (Load/Scenario) |
|---|---------|-------------|:-------------:|:-----------------:|:--------------------:|:----------------------:|
| 1 | Oracle SGA/PGA & Redo | ORIGINAL_REQUEST §R1 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 2 | Oracle CDB/PDB Slicing | ORIGINAL_REQUEST §R1 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 3 | Oracle Wait Events & Data Guard | ORIGINAL_REQUEST §R1 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 4 | Oracle AI Diagnostics | ORIGINAL_REQUEST §R1 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 5 | Worker Pool & Scheduling | ORIGINAL_REQUEST §R2 | ≥5 tests | ≥5 tests | ✓ | ✓ (100+ endpoints) |
| 6 | Circuit Breakers & Backoff | ORIGINAL_REQUEST §R2 | ≥5 tests | ≥5 tests | ✓ | ✓ (Chaos drop test) |
| 7 | Ring Buffer & SSE Streaming | ORIGINAL_REQUEST §R2 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 8 | Linux SSH Batch Parser | ORIGINAL_REQUEST §R3 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 9 | Windows WinRM/WMI Parser | ORIGINAL_REQUEST §R3 | ≥5 tests | ≥5 tests | ✓ | ✓ |
| 10 | Host-to-DB Correlation Engine | ORIGINAL_REQUEST §R3 | ≥5 tests | ≥5 tests | ✓ | ✓ |

## Test Architecture
- **Test Runner**: Node.js built-in test runner via `npx tsx --test`
- **Execution Command**: `npm test` or `npx tsx --test tests/**/*.test.ts`
- **Pass Semantics**: All test suites pass with exit code 0.

## Test Directory Layout
- `tests/unit/oracleCollector.test.ts`: Unit tests for Oracle metric parsing, CDB/PDB separation, wait classes, ASM, and Data Guard lag.
- `tests/unit/pollingEngine.test.ts`: Bounded worker pool concurrency limits, tiered scheduler intervals, ring buffer eviction, and circuit breaker state transitions.
- `tests/unit/hostParsers.test.ts`: Linux `/proc/stat`, `/proc/meminfo`, `df -Pk`, `loadavg`, `diskstats` parser tick-delta math and Windows WMI class metric parsing.
- `tests/integration/hostDbCorrelation.test.ts`: Cross-layer rule-based anomaly correlation tests.
- `tests/load/pollingLoad.test.ts`: High-concurrency load test simulating 100+ endpoints across 4 zones, event loop latency measurement, and circuit breaker backoff under 30% simulated fault injection.
