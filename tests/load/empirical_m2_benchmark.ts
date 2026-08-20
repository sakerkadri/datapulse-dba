import { BoundedWorkerPool } from "../../src/server/polling/BoundedWorkerPool";
import { EndpointCircuitBreaker } from "../../src/server/polling/CircuitBreaker";
import { CircuitState, TaskPriority } from "../../src/types/polling";

interface BenchmarkSummary {
  workerPool: {
    totalTasks: number;
    maxConfiguredConcurrency: number;
    measuredPeakConcurrency: number;
    concurrencyViolations: number;
    totalExecuted: number;
    totalFailed: number;
    totalEvicted: number;
    totalRejected: number;
    priorityDwellTimeMs: {
      l1: { avg: number; p95: number; min: number; max: number };
      l2: { avg: number; p95: number; min: number; max: number };
      l3: { avg: number; p95: number; min: number; max: number };
    };
    priorityInversions: number;
    evictionAccuracy: boolean;
  };
  circuitBreaker: {
    fastFail: {
      iterations: number;
      actualExecutions: number;
      avgLatencyUs: number;
      p50LatencyUs: number;
      p95LatencyUs: number;
      p99LatencyUs: number;
      maxLatencyUs: number;
    };
    jitterAnalysis: {
      tripsTested: number;
      allWithinBounds: boolean;
      meanJitterMultiplier: number;
      minJitterMultiplier: number;
      maxJitterMultiplier: number;
      tripDetails: Array<{
        trip: number;
        rawBackoffMs: number;
        actualCooldownMs: number;
        multiplier: number;
        pass: boolean;
      }>;
    };
    halfOpenRace: {
      concurrentRequests: number;
      probesExecuted: number;
      maxProbeConcurrency: number;
      fastFailedRequests: number;
      finalState: string;
      cleanRecovery: boolean;
    };
    timeoutEnforcement: {
      configuredTimeoutMs: number;
      measuredTimeoutElapsedMs: number;
      trippedToOpen: boolean;
    };
  };
}

async function runBenchmark(): Promise<BenchmarkSummary> {
  console.log("================================================================================");
  console.log("       STARTING EMPIRICAL BENCHMARK FOR WORKER POOL & CIRCUIT BREAKER           ");
  console.log("================================================================================\n");

  // ============================================================================
  // 1. Worker Pool: Concurrency Invariance & Saturation
  // ============================================================================
  console.log("[1/6] Running Worker Pool Concurrency Invariance Benchmark (1,000 tasks, C=20)...");
  const maxConcurrency = 20;
  const totalTasks = 1000;
  const pool = new BoundedWorkerPool("benchmark-zone", maxConcurrency, 2000);

  let peakConcurrency = 0;
  let activeCount = 0;
  let concurrencyViolations = 0;

  const tasks = Array.from({ length: totalTasks }, (_, i) => {
    const priority = (i % 3) + 1; // 1, 2, 3
    const execTime = 4 + (i % 15); // 4-18ms

    return pool.run(
      `ep_${i % 25}`,
      async () => {
        activeCount++;
        if (activeCount > peakConcurrency) peakConcurrency = activeCount;
        if (activeCount > maxConcurrency) concurrencyViolations++;

        await new Promise((r) => setTimeout(r, execTime));

        activeCount--;
        return i;
      },
      priority
    );
  });

  await Promise.all(tasks);
  console.log(`      -> Peak Concurrency Measured: ${peakConcurrency} (Limit: ${maxConcurrency})`);
  console.log(`      -> Concurrency Violations: ${concurrencyViolations}`);
  console.log(`      -> Tasks Executed: ${pool.stats.totalExecuted}\n`);

  // ============================================================================
  // 2. Worker Pool: Priority Dwell & Ordering Verification
  // ============================================================================
  console.log("[2/6] Running Priority Dwell Time & Strict Ordering Benchmark (150 queued tasks)...");
  const prioPool = new BoundedWorkerPool("prio-benchmark", 5, 500);

  let unblockSat!: () => void;
  const satPromise = new Promise<void>((r) => (unblockSat = r));

  // Saturate 5 workers
  const satTasks = Array.from({ length: 5 }, (_, i) =>
    prioPool.run(`sat_${i}`, () => satPromise, TaskPriority.L2_TELEMETRY)
  );
  await new Promise((r) => setTimeout(r, 10));

  const dwellRecords: { priority: number; queueDwellMs: number; dispatchIndex: number }[] = [];
  let dispatchSeq = 0;

  // Queue 50 L3 tasks FIRST
  const queuedL3 = Array.from({ length: 50 }, (_, i) => {
    const enqueuedAt = performance.now();
    return prioPool.run(
      `l3_${i}`,
      async () => {
        const dwell = performance.now() - enqueuedAt;
        dwellRecords.push({ priority: 1, queueDwellMs: dwell, dispatchIndex: ++dispatchSeq });
        await new Promise((r) => setTimeout(r, 2));
      },
      TaskPriority.L3_DIAGNOSTICS
    );
  });

  // Queue 50 L2 tasks SECOND
  const queuedL2 = Array.from({ length: 50 }, (_, i) => {
    const enqueuedAt = performance.now();
    return prioPool.run(
      `l2_${i}`,
      async () => {
        const dwell = performance.now() - enqueuedAt;
        dwellRecords.push({ priority: 2, queueDwellMs: dwell, dispatchIndex: ++dispatchSeq });
        await new Promise((r) => setTimeout(r, 2));
      },
      TaskPriority.L2_TELEMETRY
    );
  });

  // Queue 50 L1 tasks LAST
  const queuedL1 = Array.from({ length: 50 }, (_, i) => {
    const enqueuedAt = performance.now();
    return prioPool.run(
      `l1_${i}`,
      async () => {
        const dwell = performance.now() - enqueuedAt;
        dwellRecords.push({ priority: 3, queueDwellMs: dwell, dispatchIndex: ++dispatchSeq });
        await new Promise((r) => setTimeout(r, 2));
      },
      TaskPriority.L1_HEARTBEAT
    );
  });

  // Release saturators
  unblockSat();
  await Promise.all([...satTasks, ...queuedL1, ...queuedL2, ...queuedL3]);

  // Analyze priority inversions: any L1 dispatched after an L2 or L3?
  let priorityInversions = 0;
  const l1Records = dwellRecords.filter((r) => r.priority === 3);
  const l2Records = dwellRecords.filter((r) => r.priority === 2);
  const l3Records = dwellRecords.filter((r) => r.priority === 1);

  const maxL1DispatchIndex = Math.max(...l1Records.map((r) => r.dispatchIndex));
  const minL2DispatchIndex = Math.min(...l2Records.map((r) => r.dispatchIndex));
  const maxL2DispatchIndex = Math.max(...l2Records.map((r) => r.dispatchIndex));
  const minL3DispatchIndex = Math.min(...l3Records.map((r) => r.dispatchIndex));

  if (maxL1DispatchIndex > minL2DispatchIndex) priorityInversions++;
  if (maxL2DispatchIndex > minL3DispatchIndex) priorityInversions++;

  const calcStats = (recs: typeof dwellRecords) => {
    const times = recs.map((r) => r.queueDwellMs).sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = times[Math.floor(times.length * 0.95)];
    const min = times[0];
    const max = times[times.length - 1];
    return { avg, p95, min, max };
  };

  const l1Stats = calcStats(l1Records);
  const l2Stats = calcStats(l2Records);
  const l3Stats = calcStats(l3Records);

  console.log(`      -> L1 Dwell Avg: ${l1Stats.avg.toFixed(2)}ms (p95: ${l1Stats.p95.toFixed(2)}ms)`);
  console.log(`      -> L2 Dwell Avg: ${l2Stats.avg.toFixed(2)}ms (p95: ${l2Stats.p95.toFixed(2)}ms)`);
  console.log(`      -> L3 Dwell Avg: ${l3Stats.avg.toFixed(2)}ms (p95: ${l3Stats.p95.toFixed(2)}ms)`);
  console.log(`      -> Priority Inversions: ${priorityInversions}\n`);

  // ============================================================================
  // 3. Worker Pool: Priority-Aware Eviction & Overflow
  // ============================================================================
  console.log("[3/6] Running Priority-Aware Queue Eviction & Hard Rejection Benchmark...");
  const evictPool = new BoundedWorkerPool("evict-benchmark", 2, 10);
  let unblockEvict!: () => void;
  const evictSatPromise = new Promise<void>((r) => (unblockEvict = r));

  evictPool.run("sat1", () => evictSatPromise, 2);
  evictPool.run("sat2", () => evictSatPromise, 2);
  await new Promise((r) => setTimeout(r, 5));

  // Fill queue with 10 L3 tasks
  const l3Trackers = Array.from({ length: 10 }, (_, i) =>
    evictPool.run(`l3_evict_${i}`, async () => "ok", TaskPriority.L3_DIAGNOSTICS).catch((e) => e)
  );

  // Push 5 L2 tasks -> should evict 5 L3 tasks
  const l2Trackers = Array.from({ length: 5 }, (_, i) =>
    evictPool.run(`l2_evict_${i}`, async () => "ok", TaskPriority.L2_TELEMETRY).catch((e) => e)
  );

  // Push 5 L1 tasks -> should evict remaining 5 L3 tasks
  const l1Trackers = Array.from({ length: 5 }, (_, i) =>
    evictPool.run(`l1_evict_${i}`, async () => "ok", TaskPriority.L1_HEARTBEAT).catch((e) => e)
  );

  // Push 1 more L3 task -> should be REJECTED (queue full of L2 & L1)
  let rejectedTaskError: any = null;
  try {
    await evictPool.run("l3_rejected", async () => "ok", TaskPriority.L3_DIAGNOSTICS);
  } catch (err) {
    rejectedTaskError = err;
  }

  unblockEvict();
  await Promise.all([...l3Trackers, ...l2Trackers, ...l1Trackers]);

  const evictionAccuracy =
    evictPool.stats.totalEvicted === 10 &&
    evictPool.stats.totalRejected === 1 &&
    rejectedTaskError !== null;

  console.log(`      -> Total Evicted: ${evictPool.stats.totalEvicted} (Expected: 10)`);
  console.log(`      -> Total Rejected: ${evictPool.stats.totalRejected} (Expected: 1)`);
  console.log(`      -> Eviction Accuracy: ${evictionAccuracy ? "PASS" : "FAIL"}\n`);

  // ============================================================================
  // 4. Circuit Breaker: 10,000 Fast-Fail Benchmark
  // ============================================================================
  console.log("[4/6] Running Circuit Breaker Fast-Fail Benchmark (10,000 requests in OPEN state)...");
  const breaker = new EndpointCircuitBreaker("ep-bench-fastfail", {
    failureThreshold: 2,
    baseResetTimeoutMs: 60000,
  });

  let execCounter = 0;
  const failingFn = async () => {
    execCounter++;
    throw new Error("DB Unavailable");
  };

  // Trip to OPEN
  try { await breaker.execute(failingFn); } catch {}
  try { await breaker.execute(failingFn); } catch {}

  const fastFailLatenciesUs: number[] = [];
  const fastFailIterations = 10000;

  for (let i = 0; i < fastFailIterations; i++) {
    const t0 = performance.now();
    try {
      await breaker.execute(failingFn);
    } catch {
      const elapsedUs = (performance.now() - t0) * 1000;
      fastFailLatenciesUs.push(elapsedUs);
    }
  }

  fastFailLatenciesUs.sort((a, b) => a - b);
  const avgLatencyUs = fastFailLatenciesUs.reduce((a, b) => a + b, 0) / fastFailLatenciesUs.length;
  const p50LatencyUs = fastFailLatenciesUs[Math.floor(fastFailLatenciesUs.length * 0.50)];
  const p95LatencyUs = fastFailLatenciesUs[Math.floor(fastFailLatenciesUs.length * 0.95)];
  const p99LatencyUs = fastFailLatenciesUs[Math.floor(fastFailLatenciesUs.length * 0.99)];
  const maxLatencyUs = fastFailLatenciesUs[fastFailLatenciesUs.length - 1];

  console.log(`      -> Fast-fail executions attempted: ${execCounter} (Expected: 2, 0 while OPEN)`);
  console.log(`      -> Average Latency: ${avgLatencyUs.toFixed(2)} µs (${(avgLatencyUs / 1000).toFixed(4)} ms)`);
  console.log(`      -> P50 Latency:     ${p50LatencyUs.toFixed(2)} µs`);
  console.log(`      -> P95 Latency:     ${p95LatencyUs.toFixed(2)} µs`);
  console.log(`      -> P99 Latency:     ${p99LatencyUs.toFixed(2)} µs`);
  console.log(`      -> Max Latency:     ${maxLatencyUs.toFixed(2)} µs\n`);

  // ============================================================================
  // 5. Circuit Breaker: 50 Consecutive Trips Jitter & Backoff Analysis
  // ============================================================================
  console.log("[5/6] Running Exponential Backoff & ±25% Jitter Verification across 50 consecutive trips...");
  const jitterBreaker = new EndpointCircuitBreaker("ep-bench-jitter", {
    failureThreshold: 1,
    baseResetTimeoutMs: 1000,
    maxResetTimeoutMs: 300000,
    jitterFactor: 0.25,
  });

  const tripDetails: BenchmarkSummary["circuitBreaker"]["jitterAnalysis"]["tripDetails"] = [];
  let allWithinBounds = true;

  for (let trip = 1; trip <= 50; trip++) {
    (jitterBreaker as any).onFailure("Simulated trip");
    const status = jitterBreaker.status;
    const rawBackoff = Math.min(300000, 1000 * Math.pow(2, trip - 1));
    const minAllowed = Math.round(rawBackoff * 0.75);
    const maxAllowed = Math.round(rawBackoff * 1.25);
    const actualCooldown = status.cooldownRemainingMs;
    const multiplier = actualCooldown / rawBackoff;
    const pass = actualCooldown >= minAllowed - 2 && actualCooldown <= maxAllowed + 2;

    if (!pass) allWithinBounds = false;

    tripDetails.push({
      trip,
      rawBackoffMs: rawBackoff,
      actualCooldownMs: actualCooldown,
      multiplier,
      pass,
    });
  }

  const multipliers = tripDetails.map((t) => t.multiplier);
  const meanJitter = multipliers.reduce((a, b) => a + b, 0) / multipliers.length;
  const minJitter = Math.min(...multipliers);
  const maxJitter = Math.max(...multipliers);

  console.log(`      -> 50 Trips Bounds Check: ${allWithinBounds ? "ALL PASS [0.75 - 1.25]" : "FAIL"}`);
  console.log(`      -> Mean Jitter Multiplier: ${meanJitter.toFixed(4)} (Expected: ~1.000)`);
  console.log(`      -> Min Jitter Multiplier:  ${minJitter.toFixed(4)} (Expected: >= 0.750)`);
  console.log(`      -> Max Jitter Multiplier:  ${maxJitter.toFixed(4)} (Expected: <= 1.250)\n`);

  // ============================================================================
  // 6. Circuit Breaker: HALF_OPEN Probe Concurrency Isolation & Recovery
  // ============================================================================
  console.log("[6/6] Running HALF_OPEN Race Condition Isolation (100 concurrent requests)...");
  const halfOpenBreaker = new EndpointCircuitBreaker("ep-bench-halfopen", {
    failureThreshold: 1,
    baseResetTimeoutMs: 25,
    jitterFactor: 0,
  });

  // Trip to OPEN
  try {
    await halfOpenBreaker.execute(async () => {
      throw new Error("Trip");
    });
  } catch {}

  // Wait 35ms for cooldown to enter HALF_OPEN
  await new Promise((r) => setTimeout(r, 35));

  let probeExecCount = 0;
  let activeProbeConcurrency = 0;
  let maxProbeConcurrency = 0;

  const probeRequests = Array.from({ length: 100 }, (_, i) =>
    halfOpenBreaker
      .execute(async () => {
        probeExecCount++;
        activeProbeConcurrency++;
        if (activeProbeConcurrency > maxProbeConcurrency) maxProbeConcurrency = activeProbeConcurrency;
        await new Promise((r) => setTimeout(r, 30));
        activeProbeConcurrency--;
        return `probe_ok_${i}`;
      })
      .then(
        (val) => ({ status: "fulfilled", val }),
        (err) => ({ status: "rejected", reason: err.message })
      )
  );

  const probeResults = await Promise.all(probeRequests);
  const fulfilledCount = probeResults.filter((r) => r.status === "fulfilled").length;
  const fastFailedCount = probeResults.filter((r) => r.status === "rejected").length;
  const finalState = halfOpenBreaker.getState();
  const cleanRecovery =
    fulfilledCount === 1 &&
    fastFailedCount === 99 &&
    maxProbeConcurrency === 1 &&
    finalState === CircuitState.CLOSED &&
    halfOpenBreaker.status.consecutiveFailures === 0;

  console.log(`      -> Probes Executed: ${probeExecCount} (Expected: 1)`);
  console.log(`      -> Max Concurrent Probe Workers: ${maxProbeConcurrency} (Expected: 1)`);
  console.log(`      -> Fast-Failed Requests: ${fastFailedCount} (Expected: 99)`);
  console.log(`      -> Final Circuit State: ${finalState} (Expected: CLOSED)`);
  console.log(`      -> Clean Recovery: ${cleanRecovery ? "PASS" : "FAIL"}\n`);

  // ============================================================================
  // Execution Timeout Verification
  // ============================================================================
  const timeoutBreaker = new EndpointCircuitBreaker("ep-bench-timeout", {
    failureThreshold: 2,
    executionTimeoutMs: 30,
  });

  const tStart = performance.now();
  let timedOut = false;
  try {
    await timeoutBreaker.execute(() => new Promise((r) => setTimeout(r, 100)));
  } catch (err: any) {
    timedOut = /Timeout after 30ms/.test(err.message);
  }
  const measuredTimeoutElapsedMs = performance.now() - tStart;

  // Second timeout to trip to OPEN
  try {
    await timeoutBreaker.execute(() => new Promise((r) => setTimeout(r, 100)));
  } catch {}

  console.log("================================================================================");
  console.log("                           BENCHMARK COMPLETED                                  ");
  console.log("================================================================================\n");

  return {
    workerPool: {
      totalTasks,
      maxConfiguredConcurrency: maxConcurrency,
      measuredPeakConcurrency: peakConcurrency,
      concurrencyViolations,
      totalExecuted: pool.stats.totalExecuted,
      totalFailed: pool.stats.totalFailed,
      totalEvicted: evictPool.stats.totalEvicted,
      totalRejected: evictPool.stats.totalRejected,
      priorityDwellTimeMs: {
        l1: l1Stats,
        l2: l2Stats,
        l3: l3Stats,
      },
      priorityInversions,
      evictionAccuracy,
    },
    circuitBreaker: {
      fastFail: {
        iterations: fastFailIterations,
        actualExecutions: execCounter,
        avgLatencyUs,
        p50LatencyUs,
        p95LatencyUs,
        p99LatencyUs,
        maxLatencyUs,
      },
      jitterAnalysis: {
        tripsTested: 50,
        allWithinBounds,
        meanJitterMultiplier: meanJitter,
        minJitterMultiplier: minJitter,
        maxJitterMultiplier: maxJitter,
        tripDetails,
      },
      halfOpenRace: {
        concurrentRequests: 100,
        probesExecuted: probeExecCount,
        maxProbeConcurrency,
        fastFailedRequests: fastFailedCount,
        finalState,
        cleanRecovery,
      },
      timeoutEnforcement: {
        configuredTimeoutMs: 30,
        measuredTimeoutElapsedMs,
        trippedToOpen: timeoutBreaker.getState() === CircuitState.OPEN,
      },
    },
  };
}

runBenchmark().then((summary) => {
  console.log("JSON_SUMMARY_START");
  console.log(JSON.stringify(summary, null, 2));
  console.log("JSON_SUMMARY_END");
});
