import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BoundedWorkerPool } from "../../src/server/polling/BoundedWorkerPool";
import { EndpointCircuitBreaker } from "../../src/server/polling/CircuitBreaker";
import { CircuitState, TaskPriority } from "../../src/types/polling";

describe("Adversarial Load & Stress Suite: BoundedWorkerPool & EndpointCircuitBreaker", () => {

  describe("BoundedWorkerPool Stress & Boundary Verification", () => {

    it("Empirically verifies concurrency invariance (active <= maxConcurrency) under 600 burst tasks", async () => {
      const maxConcurrency = 15;
      const totalTasks = 600;
      const pool = new BoundedWorkerPool("stress-zone", maxConcurrency, 1000);

      let peakActive = 0;
      let currentActive = 0;
      const activeTimeline: number[] = [];

      const tasks = Array.from({ length: totalTasks }, (_, i) => {
        const priority = (i % 3) + 1; // 1 = L3, 2 = L2, 3 = L1
        const durationMs = 5 + Math.floor(Math.random() * 30); // 5-35ms

        return pool.run(
          `endpoint_${i % 20}`,
          async () => {
            currentActive++;
            if (currentActive > peakActive) {
              peakActive = currentActive;
            }
            activeTimeline.push(currentActive);

            // Invariance assertion at execution time
            assert.ok(
              currentActive <= maxConcurrency,
              `CRITICAL VIOLATION: currentActive (${currentActive}) exceeded maxConcurrency (${maxConcurrency})`
            );

            await new Promise((resolve) => setTimeout(resolve, durationMs));

            currentActive--;
            return `task_${i}_done`;
          },
          priority
        );
      });

      const results = await Promise.all(tasks);

      assert.equal(results.length, totalTasks);
      assert.equal(pool.currentActiveWorkers, 0);
      assert.equal(pool.queuedTasks, 0);
      assert.ok(peakActive <= maxConcurrency, `Peak active (${peakActive}) must be <= ${maxConcurrency}`);
      assert.equal(peakActive, maxConcurrency, `Pool should have saturated to ${maxConcurrency}`);
      assert.equal(pool.stats.totalExecuted, totalTasks);
      assert.equal(pool.stats.totalFailed, 0);
      assert.equal(pool.stats.totalRejected, 0);
      assert.equal(pool.stats.totalEvicted, 0);
    });

    it("Empirically verifies strict priority scheduling order (L1 > L2 > L3) under queue saturation", async () => {
      const maxConcurrency = 3;
      const pool = new BoundedWorkerPool("prio-zone", maxConcurrency, 100);

      // Saturate all 3 workers with slow blocking tasks (120ms)
      let unblockSaturators!: () => void;
      const saturatorPromise = new Promise<void>((r) => (unblockSaturators = r));

      const saturatorTasks = [
        pool.run("sat_1", () => saturatorPromise, TaskPriority.L2_TELEMETRY),
        pool.run("sat_2", () => saturatorPromise, TaskPriority.L2_TELEMETRY),
        pool.run("sat_3", () => saturatorPromise, TaskPriority.L2_TELEMETRY),
      ];

      // Wait a tick to ensure saturators are actively executing
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(pool.currentActiveWorkers, 3);

      const dispatchOrder: { id: string; priority: number; time: number }[] = [];

      // Enqueue 10 L3 tasks FIRST
      const l3Promises = Array.from({ length: 10 }, (_, i) => {
        return pool.run(
          `l3_${i}`,
          async () => {
            dispatchOrder.push({ id: `L3_${i}`, priority: 1, time: Date.now() });
            await new Promise((r) => setTimeout(r, 5));
          },
          TaskPriority.L3_DIAGNOSTICS
        );
      });

      // Enqueue 10 L2 tasks SECOND
      const l2Promises = Array.from({ length: 10 }, (_, i) => {
        return pool.run(
          `l2_${i}`,
          async () => {
            dispatchOrder.push({ id: `L2_${i}`, priority: 2, time: Date.now() });
            await new Promise((r) => setTimeout(r, 5));
          },
          TaskPriority.L2_TELEMETRY
        );
      });

      // Enqueue 10 L1 tasks LAST
      const l1Promises = Array.from({ length: 10 }, (_, i) => {
        return pool.run(
          `l1_${i}`,
          async () => {
            dispatchOrder.push({ id: `L1_${i}`, priority: 3, time: Date.now() });
            await new Promise((r) => setTimeout(r, 5));
          },
          TaskPriority.L1_HEARTBEAT
        );
      });

      assert.equal(pool.queuedTasks, 30);
      assert.equal(pool.stats.queuedL1, 10);
      assert.equal(pool.stats.queuedL2, 10);
      assert.equal(pool.stats.queuedL3, 10);

      // Now unblock the saturators to let queued tasks drain
      unblockSaturators();

      await Promise.all([...saturatorTasks, ...l1Promises, ...l2Promises, ...l3Promises]);

      assert.equal(dispatchOrder.length, 30);

      // Verify the first 10 drained tasks are ALL Priority 3 (L1)
      const first10 = dispatchOrder.slice(0, 10);
      for (const item of first10) {
        assert.equal(item.priority, 3, `Expected L1 (prio 3), got ${item.id}`);
      }

      // Verify the next 10 drained tasks are ALL Priority 2 (L2)
      const next10 = dispatchOrder.slice(10, 20);
      for (const item of next10) {
        assert.equal(item.priority, 2, `Expected L2 (prio 2), got ${item.id}`);
      }

      // Verify the final 10 drained tasks are ALL Priority 1 (L3)
      const last10 = dispatchOrder.slice(20, 30);
      for (const item of last10) {
        assert.equal(item.priority, 1, `Expected L3 (prio 1), got ${item.id}`);
      }
    });

    it("Empirically verifies queue overflow, priority-aware eviction, and hard rejection", async () => {
      const maxConcurrency = 2;
      const maxQueueSize = 6;
      const pool = new BoundedWorkerPool("evict-zone", maxConcurrency, maxQueueSize);

      let unblockWorkers!: () => void;
      const blockPromise = new Promise<void>((r) => (unblockWorkers = r));

      // Saturate 2 active workers
      pool.run("block1", () => blockPromise, 2);
      pool.run("block2", () => blockPromise, 2);
      await new Promise((r) => setTimeout(r, 10));

      // Queue 3 L3 tasks and 3 L2 tasks to completely fill the 6-slot queue
      const l3EvictionTrackers: Promise<any>[] = [];
      for (let i = 0; i < 3; i++) {
        l3EvictionTrackers.push(
          pool.run(`l3_${i}`, async () => "ok", TaskPriority.L3_DIAGNOSTICS).catch((err) => err)
        );
      }

      const l2Trackers: Promise<any>[] = [];
      for (let i = 0; i < 3; i++) {
        l2Trackers.push(
          pool.run(`l2_${i}`, async () => "ok", TaskPriority.L2_TELEMETRY).catch((err) => err)
        );
      }

      assert.equal(pool.queuedTasks, 6);
      assert.equal(pool.stats.queuedL3, 3);
      assert.equal(pool.stats.queuedL2, 3);

      // Now attempt to push a lower priority task (L3) when queue is full -> Must REJECT immediately
      let l3OverflowError: any = null;
      try {
        await pool.run("l3_overflow", async () => "ok", TaskPriority.L3_DIAGNOSTICS);
      } catch (err: any) {
        l3OverflowError = err;
      }
      assert.ok(l3OverflowError, "L3 task should be rejected on full queue");
      assert.match(l3OverflowError.message, /Queue overflow/);

      // Now push an L1 task (Priority 3). It should EVICT the oldest L3 task!
      const l1Task1 = pool.run("l1_priority_task1", async () => "l1_success", TaskPriority.L1_HEARTBEAT);

      assert.equal(pool.stats.totalEvicted, 1);
      assert.equal(pool.queuedTasks, 6);
      assert.equal(pool.stats.queuedL3, 2); // 1 evicted
      assert.equal(pool.stats.queuedL1, 1);

      // Check that the evicted L3 task was rejected with eviction reason
      const firstL3Result = await l3EvictionTrackers[0];
      assert.ok(firstL3Result instanceof Error);
      assert.match(firstL3Result.message, /evicted in favor of higher priority task/);

      // Push 2 more L1 tasks -> Should evict remaining 2 L3 tasks
      const l1Task2 = pool.run("l1_priority_task2", async () => "l1_success", TaskPriority.L1_HEARTBEAT);
      const l1Task3 = pool.run("l1_priority_task3", async () => "l1_success", TaskPriority.L1_HEARTBEAT);

      assert.equal(pool.stats.totalEvicted, 3);
      assert.equal(pool.stats.queuedL3, 0);
      assert.equal(pool.stats.queuedL1, 3);

      // Push another L1 task -> Should evict 1 L2 task!
      const l1Task4 = pool.run("l1_priority_task4", async () => "l1_success", TaskPriority.L1_HEARTBEAT);
      assert.equal(pool.stats.totalEvicted, 4);
      assert.equal(pool.stats.queuedL2, 2);
      assert.equal(pool.stats.queuedL1, 4);

      // Unblock workers and let everything finish cleanly
      unblockWorkers();
      await Promise.all([l1Task1, l1Task2, l1Task3, l1Task4]);
    });

    it("Empirically verifies error isolation, pool recovery, and clearQueue()", async () => {
      const pool = new BoundedWorkerPool("error-zone", 5, 200);

      // Run 50 failing tasks and 50 successful tasks concurrently
      const tasks = Array.from({ length: 100 }, (_, i) => {
        if (i % 2 === 0) {
          return pool
            .run(`err_${i}`, async () => {
              throw new Error(`Simulated failure ${i}`);
            })
            .then(
              () => ({ status: "resolved" }),
              (err) => ({ status: "rejected", error: err.message })
            );
        } else {
          return pool
            .run(`ok_${i}`, async () => `success_${i}`)
            .then(
              (res) => ({ status: "resolved", value: res }),
              (err) => ({ status: "rejected", error: err.message })
            );
        }
      });

      const results = await Promise.all(tasks);
      const failures = results.filter((r) => r.status === "rejected");
      const successes = results.filter((r) => r.status === "resolved");

      assert.equal(failures.length, 50);
      assert.equal(successes.length, 50);
      assert.equal(pool.currentActiveWorkers, 0);
      assert.equal(pool.stats.totalExecuted, 50);
      assert.equal(pool.stats.totalFailed, 50);

      // Test clearQueue
      let blocker!: () => void;
      const bPromise = new Promise<void>((r) => (blocker = r));
      pool.run("b1", () => bPromise);
      pool.run("b2", () => bPromise);
      pool.run("b3", () => bPromise);
      pool.run("b4", () => bPromise);
      pool.run("b5", () => bPromise);

      const queuedPromises: Promise<any>[] = [];
      for (let i = 0; i < 10; i++) {
        queuedPromises.push(
          pool.run(`q_${i}`, async () => "ok").catch((err) => err)
        );
      }

      assert.equal(pool.queuedTasks, 10);
      pool.clearQueue();
      assert.equal(pool.queuedTasks, 0);

      const clearedResults = await Promise.all(queuedPromises);
      for (const res of clearedResults) {
        assert.ok(res instanceof Error);
        assert.match(res.message, /Queue cleared/);
      }

      blocker();
    });
  });

  describe("EndpointCircuitBreaker Resilience, Jitter & Fast-Fail Verification", () => {

    it("Measures fast-fail latency in OPEN state across 1,000 requests (must be < 1ms with 0 calls)", async () => {
      const breaker = new EndpointCircuitBreaker("ep-fast-fail", {
        failureThreshold: 2,
        baseResetTimeoutMs: 60000, // 60s cooldown
      });

      let executionCount = 0;
      const failingAction = async () => {
        executionCount++;
        throw new Error("DB Connection Refused");
      };

      // Trip the breaker with 2 failures
      await assert.rejects(() => breaker.execute(failingAction));
      await assert.rejects(() => breaker.execute(failingAction));

      assert.equal(breaker.getState(), CircuitState.OPEN);
      assert.equal(executionCount, 2);

      // Execute 1,000 requests against OPEN breaker
      const latencies: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const start = performance.now();
        try {
          await breaker.execute(failingAction);
          assert.fail("Should have thrown fast-fail error");
        } catch (err: any) {
          const duration = performance.now() - start;
          latencies.push(duration);
          assert.match(err.message, /Circuit is OPEN/);
        }
      }

      // Verification: 0 executions were attempted during the 1,000 requests
      assert.equal(executionCount, 2, "Execution count must not increment while OPEN");

      // Latency statistics
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      latencies.sort((a, b) => a - b);
      const p95Latency = latencies[Math.floor(latencies.length * 0.95)];
      const p99Latency = latencies[Math.floor(latencies.length * 0.99)];
      const maxLatency = latencies[latencies.length - 1];

      // Assertions
      assert.ok(avgLatency < 0.2, `Average fast-fail latency (${avgLatency.toFixed(4)}ms) must be < 0.2ms`);
      assert.ok(p99Latency < 1.0, `P99 fast-fail latency (${p99Latency.toFixed(4)}ms) must be < 1.0ms`);
    });

    it("Empirically verifies exponential backoff and ±25% uniform jitter distribution across 50 consecutive trips", () => {
      const baseResetMs = 1000;
      const maxResetMs = 64000;
      const jitterFactor = 0.25;

      const breaker = new EndpointCircuitBreaker("ep-jitter-test", {
        failureThreshold: 1,
        baseResetTimeoutMs: baseResetMs,
        maxResetTimeoutMs: maxResetMs,
        jitterFactor: jitterFactor,
      });

      const tripRecords: {
        tripNumber: number;
        rawBackoff: number;
        minAllowed: number;
        maxAllowed: number;
        actualCooldown: number;
        jitterMultiplier: number;
      }[] = [];

      for (let trip = 1; trip <= 50; trip++) {
        // Force failure to trip
        (breaker as any).onFailure("Simulated network outage");

        const status = breaker.status;
        const rawBackoff = Math.min(maxResetMs, baseResetMs * Math.pow(2, trip - 1));
        const minAllowed = Math.round(rawBackoff * (1 - jitterFactor));
        const maxAllowed = Math.round(rawBackoff * (1 + jitterFactor));
        const actualCooldown = status.cooldownRemainingMs;
        const jitterMultiplier = actualCooldown / rawBackoff;

        // Strict boundary check: actual cooldown must be within [rawBackoff * 0.75 - 2, rawBackoff * 1.25 + 2]
        assert.ok(
          actualCooldown >= minAllowed - 2 && actualCooldown <= maxAllowed + 2,
          `Trip ${trip}: Cooldown (${actualCooldown}ms) outside allowed jitter range [${minAllowed}, ${maxAllowed}] for raw ${rawBackoff}ms`
        );

        tripRecords.push({
          tripNumber: trip,
          rawBackoff,
          minAllowed,
          maxAllowed,
          actualCooldown,
          jitterMultiplier,
        });
      }

      // Statistical distribution check over the 50 samples
      const multipliers = tripRecords.map((r) => r.jitterMultiplier);
      const meanMultiplier = multipliers.reduce((a, b) => a + b, 0) / multipliers.length;
      const minMultiplier = Math.min(...multipliers);
      const maxMultiplier = Math.max(...multipliers);

      // Check that mean is roughly centered around 1.0 (between 0.90 and 1.10)
      assert.ok(
        meanMultiplier >= 0.92 && meanMultiplier <= 1.08,
        `Mean jitter multiplier (${meanMultiplier.toFixed(3)}) should be close to 1.00`
      );

      // Check that jitter spans both below and above 1.0
      assert.ok(minMultiplier < 0.90, `Expected some jitter values < 0.90, min was ${minMultiplier.toFixed(3)}`);
      assert.ok(maxMultiplier > 1.10, `Expected some jitter values > 1.10, max was ${maxMultiplier.toFixed(3)}`);
    });

    it("Empirically verifies that in HALF_OPEN state, exactly 1 probe executes concurrently among 50 parallel requests", async () => {
      const breaker = new EndpointCircuitBreaker("ep-probe-test", {
        failureThreshold: 1,
        baseResetTimeoutMs: 30, // 30ms cooldown
        jitterFactor: 0, // 0 jitter for predictable timing
      });

      // Trip to OPEN
      await assert.rejects(() =>
        breaker.execute(async () => {
          throw new Error("Initial failure");
        })
      );
      assert.equal(breaker.getState(), CircuitState.OPEN);

      // Wait for cooldown to expire
      await new Promise((r) => setTimeout(r, 45));
      assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

      let probeExecutionCount = 0;
      let activeProbeConcurrency = 0;
      let maxProbeConcurrency = 0;

      const concurrentRequests = Array.from({ length: 50 }, (_, i) => {
        return breaker
          .execute(async () => {
            probeExecutionCount++;
            activeProbeConcurrency++;
            if (activeProbeConcurrency > maxProbeConcurrency) {
              maxProbeConcurrency = activeProbeConcurrency;
            }
            // Probe takes 40ms to simulate slow recovery check
            await new Promise((r) => setTimeout(r, 40));
            activeProbeConcurrency--;
            return `probe_result_${i}`;
          })
          .then(
            (res) => ({ status: "fulfilled" as const, value: res }),
            (err) => ({ status: "rejected" as const, reason: err.message })
          );
      });

      const results = await Promise.all(concurrentRequests);

      const fulfilled = results.filter((r): r is { status: "fulfilled"; value: string } => r.status === "fulfilled");
      const rejected = results.filter((r): r is { status: "rejected"; reason: string } => r.status === "rejected");

      // EXACTLY 1 request must have executed and succeeded
      assert.equal(probeExecutionCount, 1, "Exactly 1 probe function must execute");
      assert.equal(maxProbeConcurrency, 1, "Probe concurrency must never exceed 1");
      assert.equal(fulfilled.length, 1, "Exactly 1 promise should be fulfilled");
      assert.equal(rejected.length, 49, "49 promises should be fast-failed");

      // Verify rejection reasons
      for (const rej of rejected) {
        assert.match(String(rej.reason), /Recovery probe already in flight/);
      }

      // Verify circuit is now CLOSED
      assert.equal(breaker.getState(), CircuitState.CLOSED);
      assert.equal(breaker.status.consecutiveFailures, 0);
      assert.equal(breaker.status.consecutiveTrips, 0);
    });

    it("Empirically verifies fallback handler and executionTimeoutMs enforcement", async () => {
      const breaker = new EndpointCircuitBreaker("ep-timeout-test", {
        failureThreshold: 2,
        baseResetTimeoutMs: 10000,
        executionTimeoutMs: 40, // 40ms timeout
      });

      // 1. Test query timeout
      const hungAction = () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 150));

      const start = performance.now();
      await assert.rejects(
        () => breaker.execute(hungAction),
        /Timeout after 40ms/
      );
      const elapsed = performance.now() - start;
      assert.ok(elapsed >= 38 && elapsed <= 80, `Elapsed time (${elapsed.toFixed(1)}ms) should be near 40ms`);
      assert.equal(breaker.status.consecutiveFailures, 1);

      // 2. Test fallback mechanism on failure
      const fallbackResult = await breaker.execute(hungAction, (reason) => `fallback_handled: ${reason}`);
      assert.match(fallbackResult, /fallback_handled: Execution failed: Timeout after 40ms/);
      assert.equal(breaker.status.consecutiveFailures, 2);
      assert.equal(breaker.getState(), CircuitState.OPEN);

      // 3. Test fallback mechanism while OPEN
      const openFallbackResult = await breaker.execute(
        async () => "never_run",
        (reason) => `cached_data_fallback: ${reason}`
      );
      assert.match(openFallbackResult, /cached_data_fallback: Circuit is OPEN/);
    });

    it("Verifies clean manual reset and lifecycle transition counters", () => {
      const breaker = new EndpointCircuitBreaker("ep-reset-test", {
        failureThreshold: 2,
      });

      (breaker as any).onFailure("Err 1");
      (breaker as any).onFailure("Err 2");
      assert.equal(breaker.getState(), CircuitState.OPEN);
      assert.equal(breaker.status.totalTrips, 1);

      breaker.reset();
      assert.equal(breaker.getState(), CircuitState.CLOSED);
      assert.equal(breaker.status.consecutiveFailures, 0);
      assert.equal(breaker.status.consecutiveTrips, 0);
      assert.equal(breaker.status.halfOpenProbeInFlight, false);
      assert.equal(breaker.status.lastFailureReason, undefined);
    });
  });
});
