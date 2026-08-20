# Handoff Report — Explorer 2: Polling Engine & Host Metric Parsers Unit Test Architecture (Milestone 4)

**From:** teamwork_preview_explorer_test_2  
**To:** Sub-Orchestrator (teamwork_preview_sub_orch_test) / Parent Orchestrator  
**Date:** 2026-08-19  
**Artifacts Generated:**
- `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_test_2/analysis.md`
- `/home/saker/Desktop/projects_gemini/datapulse-dba/.agents/teamwork_preview_explorer_test_2/handoff.md`

---

## 1. Observation

1. **Test Infrastructure Specification (`TEST_INFRA.md:25-32`)**:
   - Test runner command: `npx tsx --test` or `npm test`
   - Feature 5 (Worker Pool & Scheduling): requires $\ge 5$ Tier 1 (Unit) and $\ge 5$ Tier 2 (Boundary) tests.
   - Feature 6 (Circuit Breakers & Backoff): requires $\ge 5$ Tier 1 (Unit) and $\ge 5$ Tier 2 (Boundary) tests.
   - Feature 7 (Ring Buffer & SSE Streaming): requires $\ge 5$ Tier 1 (Unit) and $\ge 5$ Tier 2 (Boundary) tests.
   - Feature 8 (Linux SSH Batch Parser): requires $\ge 5$ Tier 1 (Unit) and $\ge 5$ Tier 2 (Boundary) tests.
   - Feature 9 (Windows WinRM/WMI Parser): requires $\ge 5$ Tier 1 (Unit) and $\ge 5$ Tier 2 (Boundary) tests.
   - Assigned test files: `tests/unit/pollingEngine.test.ts` and `tests/unit/hostParsers.test.ts`.

2. **Distributed Polling Engine Architecture (`PROJECT.md:108-113`, `.agents/skills/distributed-polling-engine/SKILL.md:16-85`)**:
   - `BoundedWorkerPool`: Zone-partitioned worker queues with `maxConcurrency` (e.g. 10 per zone), `maxQueueSize` (e.g. 500), and priority queuing (L1 Heartbeat = Priority 3, L2 Telemetry = Priority 2, L3 Deep Diagnostics = Priority 1) with FIFO tie-breaker by task creation timestamp.
   - `EndpointCircuitBreaker`: State machine `CLOSED -> OPEN -> HALF_OPEN -> CLOSED`. Exponential backoff formula $T_{\text{backoff}} = \min(T_{\text{max}}, T_{\text{base}} \times 2^{\text{trips}-1})$, full jitter ($\pm 25\%$), fast-fail in `OPEN` state, and single in-flight probe guard in `HALF_OPEN` state.
   - `TelemetryRingBuffer`: Fixed-size circular array of $N=60$ samples with $O(1)$ push, oldest-sample eviction, and immutability snapshots.
   - `TieredScheduler`: Multi-tiered cadence intervals (L1 Heartbeat 5-10s, L2 Telemetry 30-60s, L3 Deep Diagnostics 5-15m) with adaptive cadence throttling when CPU $>90\%$.

3. **Agentless Host Monitoring Architecture (`PROJECT.md:114-118`, `.agents/skills/agentless-server-monitoring/SKILL.md:15-64`)**:
   - `LinuxHostMetricParser`: Parses atomic single-command batch script containing `===CPU===`, `===MEM===`, `===DISK===`, `===LOAD===`, `===IO===`, `===UPTIME===`.
     - CPU tick delta: $\text{CPU\%} = \frac{\Delta \text{Active}}{\Delta \text{Total}} \times 100$, with user, system, iowait, and steal breakdown.
     - Memory: $\text{MemTotal}$, $\text{MemAvailable}$ (or fallback $\text{MemFree} + \text{Buffers} + \text{Cached}$), $\text{SwapTotal}$, $\text{SwapFree}$.
     - Disk: `df -Pk` filtering pseudo-filesystems (`tmpfs`, `devtmpfs`, `overlay`, `squashfs`).
     - Load: `/proc/loadavg` 1m, 5m, 15m.
     - IO: `/proc/diskstats` read and write aggregation skipping loopback devices.
   - `WindowsWmiMetricParser`: Parses WQL class payloads:
     - CPU: `Win32_PerfFormattedData_PerfOS_Processor` (`PercentProcessorTime`) with fallback to `Win32_Processor` (`LoadPercentage`).
     - Memory: `Win32_OperatingSystem` (`TotalVisibleMemorySize`, `FreePhysicalMemory` in KB).
     - Disks: `Win32_LogicalDisk` filtering `DriveType = 3` (Fixed Disks).
     - Uptime: `LastBootUpTime` WMI date string parser.
     - IOPS: `Win32_PerfFormattedData_PerfDisk_PhysicalDisk` (`DiskTransfersPerSec`).

4. **Package Configuration (`package.json:30-39`)**:
   - `tsx` version `^4.21.0` and `@types/node` version `^22.14.0` are installed, providing out-of-the-box support for `node:test` execution via `npx tsx --test`.

---

## 2. Logic Chain

1. **From Observation 1 & 4**: Node.js has a built-in test runner (`node:test`) and assertion library (`node:assert/strict`). Using native `node:test` executed via `npx tsx --test` fulfills all requirements in `TEST_INFRA.md` with zero additional npm package dependencies, zero transpile overhead, and sub-second execution speeds.
2. **From Observation 1 & 2**: `tests/unit/pollingEngine.test.ts` must comprehensively test all 4 core components of the polling subsystem:
   - `BoundedWorkerPool`: 5 Unit tests (concurrency limits, priority ordering, FIFO tie-breaking, task resolution, error propagation) + 5 Boundary tests (queue overflow, single concurrency, high burst stress, stats accuracy, empty drain). Total: 10 tests.
   - `EndpointCircuitBreaker`: 7 Unit tests (initial state, normal execution, threshold trip, fast-fail in OPEN, cooldown transition to HALF_OPEN, probe recovery, probe failure reversion) + 5 Boundary tests (intermediate success reset, single in-flight probe guard, exponential backoff scaling, jitter bounds, execution timeout). Total: 12 tests.
   - `TelemetryRingBuffer`: 5 Unit tests (initial state, sequential push, circular overrun eviction, latest pointer tracking, clear reset) + 3 Boundary tests (capacity 1, immutability snapshot, memory containment). Total: 8 tests.
   - `TieredScheduler`: 4 Unit tests (cadence configuration, register/unregister, on-demand poll, lifecycle start/stop) + 2 Boundary tests (adaptive load throttling, pause/resume). Total: 6 tests.
   - **Total Polling Engine Unit Tests:** 36 tests (exceeding the $\ge 15$ unit + $\ge 15$ boundary test mandate).
3. **From Observation 1 & 3**: `tests/unit/hostParsers.test.ts` must comprehensively verify Linux and Windows metric parsing:
   - Linux `/proc/stat` CPU Parser: 5 Unit tests (first tick baseline, delta math, breakdown metrics, 100% idle, 100% busy) + 5 Boundary tests (zero delta, reboot counter wrap, high iowait, steal time, multi-core filtering). Total: 10 tests.
   - Linux `/proc/meminfo` Memory Parser: 5 Unit tests (standard parsing, legacy fallback without MemAvailable, swap space, zero swap, page cache model) + 2 Boundary tests (near OOM, malformed whitespace). Total: 7 tests.
   - Linux `/proc/loadavg`, `df -Pk`, `diskstats`: 5 Unit tests (loadavg, df mount parsing, pseudo-fs filtering, diskstats IOPS, uptime) + 2 Boundary tests (100% full disk, composite batch script parsing). Total: 7 tests.
   - Windows WMI/WinRM Parser: 7 Unit tests (cpu formatted data, load percentage fallback, physical memory KB->GB, fixed disks filtering, non-fixed disks ignored, LastBootUpTime uptime, IOPS) + 2 Boundary tests (empty payload defaults, malformed boot date). Total: 9 tests.
   - **Total Host Parsers Unit Tests:** 33 tests (exceeding the $\ge 10$ unit + $\ge 10$ boundary test mandate).
4. **From Logic Steps 2 & 3**: The designed test suites cover all functional, mathematical, edge, and error recovery scenarios defined in ORIGINAL_REQUEST §R2, §R3 and PROJECT.md Features 5–9.

---

## 3. Caveats

1. **Integration and Load Tests**: Cross-layer host-to-DB correlation (`tests/integration/hostDbCorrelation.test.ts`) and 100+ endpoints high-concurrency load testing (`tests/load/pollingLoad.test.ts`) are assigned to Explorer 3 and are outside the scope of this unit test design.
2. **Oracle Collector Unit Tests**: Oracle metrics and CDB/PDB parsing unit tests (`tests/unit/oracleCollector.test.ts`) are assigned to Explorer 1 and are outside the scope of this document.
3. **Implementation Sync**: The unit tests assume module export paths either in `src/server/polling/` & `src/server/host/` or `src/engine/` & `src/collectors/os/`. The test import paths should match the concrete file layout created by Milestone 2 and Milestone 3 implementers.

---

## 4. Conclusion

The unit test designs for `tests/unit/pollingEngine.test.ts` (36 test cases) and `tests/unit/hostParsers.test.ts` (33 test cases) provide complete, opaque-box, deterministic verification for:
- Concurrency bounding, priority queueing, and queue overflow protection in worker pools.
- 3-tiered cadence scheduling and adaptive load throttling.
- Circuit breaker state machine transitions, exponential backoff, jitter, fast-failing in `OPEN`, and single-probe `HALF_OPEN` guards.
- Lock-free sliding window circular buffer eviction and memory containment.
- Linux CPU tick delta percentage calculations, memory available vs free arithmetic, disk filtering, and IOPS parsing.
- Windows WMI formatted performance, physical memory, and logical disk parsing.

All test designs are documented with executable TypeScript code, mock fixtures, and assertion expectations in `analysis.md`.

---

## 5. Verification Method

### Test Execution Commands
```bash
# Run polling engine unit tests
npx tsx --test tests/unit/pollingEngine.test.ts

# Run host parsers unit tests
npx tsx --test tests/unit/hostParsers.test.ts

# Run all unit tests
npx tsx --test tests/unit/*.test.ts
```

### Invalidation Conditions
- Any test failing with non-zero exit code.
- Unhandled Promise rejections or hanging event loop timers.
- Observed worker pool concurrency exceeding `maxConcurrency`.
- Circuit breaker executing network calls during `OPEN` state.
- Linux CPU calculation producing `NaN` or negative percentages upon zero delta or counter wrap.
- Memory leak or unbound growth in `TelemetryRingBuffer` after 10,000+ insertions.
