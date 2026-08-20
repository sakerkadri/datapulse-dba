import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BoundedWorkerPool } from "../../src/server/polling/BoundedWorkerPool";
import { EndpointCircuitBreaker } from "../../src/server/polling/CircuitBreaker";
import { TelemetryRingBuffer } from "../../src/server/polling/TelemetryRingBuffer";
import { TieredScheduler } from "../../src/server/polling/TieredScheduler";
import { PollingEngine } from "../../src/server/polling/PollingEngine";
import { CircuitState, PollingEndpoint, TelemetrySample } from "../../src/types/polling";
import { DBInstance } from "../../src/types/dba";

describe("PollingEngine Core Unit Test Suite", () => {
  describe("BoundedWorkerPool", () => {
    it("should bound concurrency to maxConcurrency limit", async () => {
      const pool = new BoundedWorkerPool("us-east-1", 3, 50);
      let currentConcurrent = 0;
      let maxObservedConcurrent = 0;

      const tasks = Array.from({ length: 10 }, (_, i) =>
        pool.run(`endpoint-${i}`, async () => {
          currentConcurrent++;
          maxObservedConcurrent = Math.max(maxObservedConcurrent, currentConcurrent);
          await new Promise((r) => setTimeout(r, 20));
          currentConcurrent--;
          return `result-${i}`;
        })
      );

      const results = await Promise.all(tasks);
      assert.strictEqual(results.length, 10);
      assert.ok(maxObservedConcurrent <= 3, `Observed concurrency ${maxObservedConcurrent} exceeded limit 3`);
      assert.strictEqual(pool.stats.activeWorkers, 0);
      assert.strictEqual(pool.stats.queuedTasks, 0);
      assert.strictEqual(pool.stats.totalExecuted, 10);
    });

    it("should prioritize L1 Heartbeat (p3) over L2 (p2) and L3 Deep (p1) tasks", async () => {
      const pool = new BoundedWorkerPool("eu-west-1", 1, 50);
      const executionOrder: string[] = [];

      // Saturate pool with blocker
      const blocker = pool.run("blocker", () => new Promise((r) => setTimeout(r, 40)));

      // Queue tasks in reverse priority order
      const p1Task = pool.run("l3-deep", async () => {
        executionOrder.push("L3_DEEP");
      }, 1);

      const p2Task = pool.run("l2-telemetry", async () => {
        executionOrder.push("L2_TELEMETRY");
      }, 2);

      const p3Task = pool.run("l1-heartbeat", async () => {
        executionOrder.push("L1_HEARTBEAT");
      }, 3);

      await Promise.all([blocker, p1Task, p2Task, p3Task]);
      assert.deepStrictEqual(executionOrder, ["L1_HEARTBEAT", "L2_TELEMETRY", "L3_DEEP"]);
    });

    it("should maintain FIFO ordering within the same priority tier", async () => {
      const pool = new BoundedWorkerPool("us-west-1", 1, 50);
      const executionOrder: string[] = [];

      const blocker = pool.run("blocker", () => new Promise((r) => setTimeout(r, 30)));

      const t1 = pool.run("t1", async () => { executionOrder.push("task-1"); }, 2);
      const t2 = pool.run("t2", async () => { executionOrder.push("task-2"); }, 2);
      const t3 = pool.run("t3", async () => { executionOrder.push("task-3"); }, 2);

      await Promise.all([blocker, t1, t2, t3]);
      assert.deepStrictEqual(executionOrder, ["task-1", "task-2", "task-3"]);
    });

    it("should release worker slot and propagate error on task failure", async () => {
      const pool = new BoundedWorkerPool("apac-1", 2, 10);

      await assert.rejects(
        pool.run("failing-task", async () => {
          throw new Error("Simulated database network timeout");
        }),
        /Simulated database network timeout/
      );

      assert.strictEqual(pool.stats.activeWorkers, 0);
      assert.strictEqual(pool.stats.totalFailed, 1);

      // Verify pool can process next task normally
      const nextRes = await pool.run("healthy-task", async () => "healthy");
      assert.strictEqual(nextRes, "healthy");
      assert.strictEqual(pool.stats.totalExecuted, 1);
    });

    it("should evict lower priority task or reject when maxQueueSize is exceeded", async () => {
      const pool = new BoundedWorkerPool("us-east-dc", 1, 2);

      // 1 active task
      const blocker = pool.run("b", () => new Promise((r) => setTimeout(r, 60)), 2);

      // Fill queue with 2 tasks of priority 1 (L3)
      let p1Evicted = false;
      const q1 = pool.run("q1_p1", () => Promise.resolve("q1"), 1).catch((err) => {
        p1Evicted = true;
        assert.ok(err.message.includes("evicted in favor of higher priority"));
      });
      const q2 = pool.run("q2_p1", () => Promise.resolve("q2"), 1);

      // Submit high priority task (p3) -> should evict q1 (p1)
      const q3 = pool.run("q3_p3", async () => "q3_success", 3);

      // Submit another p3 task when queue is now full (q2 p1 + q3 p3 = 2 items)
      // Since there is still q2 (p1), submitting p3 should evict q2
      let p2Evicted = false;
      const q2Catch = q2.catch((err) => {
        p2Evicted = true;
        assert.ok(err.message.includes("evicted"));
      });
      const q4 = pool.run("q4_p3", async () => "q4_success", 3);

      // Now queue has 2 p3 tasks. Submitting another p3 task should overflow and reject immediately
      await assert.rejects(
        pool.run("q5_overflow", () => Promise.resolve("q5"), 3),
        /Queue overflow/
      );

      await Promise.all([blocker, q1, q2Catch, q3, q4]);
      assert.strictEqual(p1Evicted, true);
      assert.strictEqual(p2Evicted, true);
    });

    it("should accurately report WorkerPoolStats", async () => {
      const pool = new BoundedWorkerPool("zone-stats", 5, 20);
      assert.strictEqual(pool.stats.zone, "zone-stats");
      assert.strictEqual(pool.stats.maxConcurrency, 5);
      assert.strictEqual(pool.stats.maxQueueSize, 20);
      assert.strictEqual(pool.stats.activeWorkers, 0);
      assert.strictEqual(pool.stats.queuedTasks, 0);

      await pool.run("t", async () => "done");
      assert.strictEqual(pool.stats.totalExecuted, 1);
      assert.ok(pool.stats.avgExecutionTimeMs >= 0);
    });
  });

  describe("EndpointCircuitBreaker", () => {
    it("should start in CLOSED state with zero failure counters", () => {
      const cb = new EndpointCircuitBreaker("ora-01", { failureThreshold: 3 });
      assert.strictEqual(cb.getState(), CircuitState.CLOSED);
      assert.strictEqual(cb.status.consecutiveFailures, 0);
      assert.strictEqual(cb.status.consecutiveTrips, 0);
      assert.strictEqual(cb.status.totalTrips, 0);
    });

    it("should trip from CLOSED to OPEN after reaching failureThreshold", async () => {
      const cb = new EndpointCircuitBreaker("ora-02", {
        failureThreshold: 3,
        baseResetTimeoutMs: 1000,
        jitterFactor: 0,
      });

      // Fail 1
      await cb.execute(() => Promise.reject(new Error("Err1")), (msg) => msg);
      assert.strictEqual(cb.getState(), CircuitState.CLOSED);
      assert.strictEqual(cb.status.consecutiveFailures, 1);

      // Fail 2
      await cb.execute(() => Promise.reject(new Error("Err2")), (msg) => msg);
      assert.strictEqual(cb.getState(), CircuitState.CLOSED);
      assert.strictEqual(cb.status.consecutiveFailures, 2);

      // Fail 3 -> Trips to OPEN
      await cb.execute(() => Promise.reject(new Error("Err3")), (msg) => msg);
      assert.strictEqual(cb.getState(), CircuitState.OPEN);
      assert.strictEqual(cb.status.consecutiveTrips, 1);
      assert.strictEqual(cb.status.totalTrips, 1);
    });

    it("should fast-fail in OPEN state without calling the action function", async () => {
      const cb = new EndpointCircuitBreaker("ora-03", {
        failureThreshold: 1,
        baseResetTimeoutMs: 5000,
        jitterFactor: 0,
      });

      await cb.execute(() => Promise.reject(new Error("Down")), (msg) => msg);
      assert.strictEqual(cb.getState(), CircuitState.OPEN);

      let actionCalled = false;
      const startTime = Date.now();
      const res = await cb.execute(
        async () => {
          actionCalled = true;
          return "success";
        },
        (reason) => `fallback: ${reason}`
      );
      const elapsed = Date.now() - startTime;

      assert.strictEqual(actionCalled, false);
      assert.ok(res.includes("Fast-failing"));
      assert.ok(elapsed < 10, `Fast-fail took ${elapsed}ms, expected <10ms`);
    });

    it("should transition OPEN -> HALF_OPEN after cooldown and recover to CLOSED on probe success", async () => {
      const cb = new EndpointCircuitBreaker("ora-04", {
        failureThreshold: 1,
        baseResetTimeoutMs: 30,
        jitterFactor: 0,
      });

      await cb.execute(() => Promise.reject(new Error("Trip")), (msg) => msg);
      assert.strictEqual(cb.getState(), CircuitState.OPEN);

      // Wait for cooldown
      await new Promise((r) => setTimeout(r, 45));
      assert.strictEqual(cb.getState(), CircuitState.HALF_OPEN);

      // Probe success
      const result = await cb.execute(() => Promise.resolve("recovered"), (msg) => msg);
      assert.strictEqual(result, "recovered");
      assert.strictEqual(cb.getState(), CircuitState.CLOSED);
      assert.strictEqual(cb.status.consecutiveFailures, 0);
      assert.strictEqual(cb.status.consecutiveTrips, 0);
      assert.strictEqual(cb.status.totalSuccesses, 1);
    });

    it("should revert HALF_OPEN -> OPEN on probe failure with exponential backoff", async () => {
      const cb = new EndpointCircuitBreaker("ora-05", {
        failureThreshold: 1,
        baseResetTimeoutMs: 30,
        jitterFactor: 0,
      });

      await cb.execute(() => Promise.reject(new Error("Fail 1")), (msg) => msg);
      assert.strictEqual(cb.getState(), CircuitState.OPEN);

      await new Promise((r) => setTimeout(r, 45));
      assert.strictEqual(cb.getState(), CircuitState.HALF_OPEN);

      // Probe fails
      await cb.execute(() => Promise.reject(new Error("Probe failed")), (msg) => msg);
      assert.strictEqual(cb.getState(), CircuitState.OPEN);
      assert.strictEqual(cb.status.consecutiveTrips, 2);
    });

    it("should guard against concurrent probes in HALF_OPEN state", async () => {
      const cb = new EndpointCircuitBreaker("ora-06", {
        failureThreshold: 1,
        baseResetTimeoutMs: 20,
        jitterFactor: 0,
      });

      await cb.execute(() => Promise.reject(new Error("Fail")), (msg) => msg);
      await new Promise((r) => setTimeout(r, 30));
      assert.strictEqual(cb.getState(), CircuitState.HALF_OPEN);

      // Start a slow probe
      const slowProbe = cb.execute(
        () => new Promise((r) => setTimeout(() => r("probe1"), 50)),
        (msg) => msg
      );

      // Immediate second probe during in-flight
      const secondProbe = await cb.execute(
        () => Promise.resolve("probe2"),
        (msg) => `fallback: ${msg}`
      );

      assert.ok(secondProbe.includes("already in flight"));
      const firstResult = await slowProbe;
      assert.strictEqual(firstResult, "probe1");
      assert.strictEqual(cb.getState(), CircuitState.CLOSED);
    });

    it("should enforce executionTimeoutMs and trip on hung queries", async () => {
      const cb = new EndpointCircuitBreaker("ora-07", {
        failureThreshold: 1,
        executionTimeoutMs: 25,
      });

      await assert.rejects(
        cb.execute(() => new Promise((r) => setTimeout(r, 100))),
        /Timeout after 25ms/
      );

      assert.strictEqual(cb.getState(), CircuitState.OPEN);
    });

    it("should reset circuit breaker state cleanly", () => {
      const cb = new EndpointCircuitBreaker("ora-08");
      cb.reset();
      assert.strictEqual(cb.getState(), CircuitState.CLOSED);
      assert.strictEqual(cb.status.consecutiveFailures, 0);
      assert.strictEqual(cb.status.consecutiveTrips, 0);
    });
  });

  describe("TelemetryRingBuffer", () => {
    it("should start empty with correct initial properties", () => {
      const buffer = new TelemetryRingBuffer<TelemetrySample>(60);
      assert.strictEqual(buffer.capacity, 60);
      assert.strictEqual(buffer.size, 0);
      assert.strictEqual(buffer.latest, null);
      assert.deepStrictEqual(buffer.toArray(), []);
    });

    it("should store samples sequentially and evict oldest on circular overrun", () => {
      const buffer = new TelemetryRingBuffer<{ id: number; timestamp: string }>(3);

      buffer.push({ id: 1, timestamp: "2026-08-19T10:00:00Z" });
      buffer.push({ id: 2, timestamp: "2026-08-19T10:00:01Z" });
      assert.strictEqual(buffer.size, 2);
      assert.strictEqual(buffer.latest?.id, 2);

      buffer.push({ id: 3, timestamp: "2026-08-19T10:00:02Z" });
      assert.strictEqual(buffer.size, 3);
      assert.deepStrictEqual(buffer.toArray().map((x) => x.id), [1, 2, 3]);

      // Overrun by 2 items (1 and 2 should be evicted)
      buffer.push({ id: 4, timestamp: "2026-08-19T10:00:03Z" });
      buffer.push({ id: 5, timestamp: "2026-08-19T10:00:04Z" });
      assert.strictEqual(buffer.size, 3);
      assert.deepStrictEqual(buffer.toArray().map((x) => x.id), [3, 4, 5]);
      assert.strictEqual(buffer.latest?.id, 5);
    });

    it("should guarantee immutability of toArray() output", () => {
      const buffer = new TelemetryRingBuffer<{ val: number }>(5);
      buffer.push({ val: 10 });
      buffer.push({ val: 20 });

      const snap = buffer.toArray();
      snap.push({ val: 999 });
      snap[0].val = 9999;

      assert.strictEqual(buffer.size, 2);
      assert.strictEqual(buffer.toArray().length, 2);
    });

    it("should calculate mathematical rolling statistics (min, max, avg, p95)", () => {
      const buffer = new TelemetryRingBuffer<{ cpu: number; timestamp: string }>(10);
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      values.forEach((v) => buffer.push({ cpu: v, timestamp: new Date().toISOString() }));

      const stats = buffer.getRollingStats((s) => s.cpu);
      assert.strictEqual(stats.min, 10);
      assert.strictEqual(stats.max, 100);
      assert.strictEqual(stats.avg, 55);
      assert.strictEqual(stats.latest, 100);
      assert.strictEqual(stats.count, 10);
      assert.strictEqual(stats.p95, 100);
    });

    it("should generate full RollingMetricsSummary for TelemetrySample", () => {
      const buffer = new TelemetryRingBuffer<TelemetrySample>(5);
      for (let i = 1; i <= 5; i++) {
        buffer.push({
          instanceId: "inst-01",
          timestamp: new Date().toISOString(),
          cpu: i * 10,
          memory: 40 + i,
          iops: i * 200,
          activeConnections: i * 5,
          maxConnections: 100,
          queryLatencyMs: i * 2.5,
          slowQueryCount: 0,
          replicationLagSeconds: 0,
          bufferHitRatio: 99.0,
          deadlocksCount: 0,
          diskFreeGb: 100,
          diskTotalGb: 500,
        });
      }

      const summary = buffer.getMetricSummary();
      assert.strictEqual(summary.instanceId, "inst-01");
      assert.strictEqual(summary.sampleCount, 5);
      assert.strictEqual(summary.cpu.min, 10);
      assert.strictEqual(summary.cpu.max, 50);
      assert.strictEqual(summary.cpu.avg, 30);
      assert.strictEqual(summary.latencyMs.latest, 12.5);
    });

    it("should clear all elements and reset pointers", () => {
      const buffer = new TelemetryRingBuffer<{ x: number }>(5);
      buffer.push({ x: 1 });
      buffer.push({ x: 2 });
      buffer.clear();

      assert.strictEqual(buffer.size, 0);
      assert.strictEqual(buffer.latest, null);
      assert.deepStrictEqual(buffer.toArray(), []);
    });

    it("should handle capacity of 1 as a single-element sliding cell", () => {
      const buffer = new TelemetryRingBuffer<{ val: number }>(1);
      buffer.push({ val: 1 });
      assert.strictEqual(buffer.size, 1);
      assert.strictEqual(buffer.latest?.val, 1);

      buffer.push({ val: 2 });
      assert.strictEqual(buffer.size, 1);
      assert.strictEqual(buffer.latest?.val, 2);
      assert.deepStrictEqual(buffer.toArray(), [{ val: 2 }]);
    });
  });

  describe("TieredScheduler", () => {
    it("should register and unregister endpoints cleanly", () => {
      const dispatched: string[] = [];
      const scheduler = new TieredScheduler(async (ep, tier) => {
        dispatched.push(`${ep.id}:${tier}`);
      }, 50);

      const endpoint: PollingEndpoint = {
        id: "test-ep-1",
        name: "Test DB",
        engine: "Oracle",
        host: "localhost",
        port: 1521,
        databaseName: "ORCL",
        zone: "us-east-1",
        enabled: true,
      };

      scheduler.registerEndpoint(endpoint);
      assert.strictEqual(scheduler.registeredEndpointsCount, 1);
      assert.ok(scheduler.getEndpointState("test-ep-1"));

      const removed = scheduler.unregisterEndpoint("test-ep-1");
      assert.strictEqual(removed, true);
      assert.strictEqual(scheduler.registeredEndpointsCount, 0);
    });

    it("should execute onDemandPoll immediately", async () => {
      const calls: string[] = [];
      const scheduler = new TieredScheduler(async (ep, tier) => {
        calls.push(`${ep.id}-${tier}`);
      });

      scheduler.registerEndpoint({
        id: "ondemand-ep",
        name: "OD DB",
        engine: "PostgreSQL",
        host: "localhost",
        port: 5432,
        databaseName: "postgres",
        zone: "eu-west-1",
        enabled: true,
      });

      await scheduler.onDemandPoll("ondemand-ep", "L1");
      await scheduler.onDemandPoll("ondemand-ep", "L2");

      assert.deepStrictEqual(calls, ["ondemand-ep-L1", "ondemand-ep-L2"]);
    });

    it("should dynamically throttle cadence on CPU overload (>= 90%) and recover", () => {
      const scheduler = new TieredScheduler(async () => {});
      scheduler.registerEndpoint({
        id: "overloaded-ep",
        name: "High CPU DB",
        engine: "Oracle",
        host: "localhost",
        port: 1521,
        databaseName: "ORCLCDB",
        zone: "us-east-1",
        enabled: true,
        cadenceConfig: {
          l1IntervalMs: 5000,
          l2IntervalMs: 30000,
          l3IntervalMs: 300000,
          adaptiveThrottlingEnabled: true,
          adaptiveCpuThresholdPct: 90,
          adaptiveConnThresholdPct: 90,
          adaptiveL3Multiplier: 2.0,
        },
      });

      const state = scheduler.getEndpointState("overloaded-ep")!;
      assert.strictEqual(state.isThrottled, false);

      // Trigger high CPU
      scheduler.updateLoadMetrics("overloaded-ep", 94.5, 50);
      assert.strictEqual(state.isThrottled, true);

      // Normal CPU tick 1 (requires 2 recovery ticks)
      scheduler.updateLoadMetrics("overloaded-ep", 45.0, 30);
      assert.strictEqual(state.isThrottled, true);

      // Normal CPU tick 2 -> Recovers to unthrottled
      scheduler.updateLoadMetrics("overloaded-ep", 42.0, 25);
      assert.strictEqual(state.isThrottled, false);
    });

    it("should start and stop lifecycle without leaking timer intervals", () => {
      const scheduler = new TieredScheduler(async () => {}, 10);
      scheduler.start();
      assert.strictEqual(scheduler.getStatus(), "RUNNING");

      scheduler.pause();
      assert.strictEqual(scheduler.getStatus(), "PAUSED");

      scheduler.resume();
      assert.strictEqual(scheduler.getStatus(), "RUNNING");

      scheduler.stop();
      assert.strictEqual(scheduler.getStatus(), "STOPPED");
    });
  });

  describe("PollingEngine Integration", () => {
    it("should coordinate full polling lifecycle and emit telemetry and circuit events", async () => {
      const engine = new PollingEngine({
        defaultZoneConcurrency: 5,
        bufferCapacity: 20,
        circuitBreakerThreshold: 2,
      });

      const telemetryEvents: any[] = [];
      const heartbeatEvents: any[] = [];
      engine.on("telemetry_delta", (evt) => telemetryEvents.push(evt));
      engine.on("heartbeat", (evt) => heartbeatEvents.push(evt));

      const endpoint: PollingEndpoint = {
        id: "pe-db-01",
        name: "Test Polling DB",
        engine: "Oracle",
        host: "localhost",
        port: 1521,
        databaseName: "ORCL",
        zone: "us-east-dc",
        enabled: true,
      };

      engine.registerEndpoint(endpoint);
      assert.ok(engine.getZonePool("us-east-dc"));
      assert.ok(engine.getCircuitBreaker("pe-db-01"));
      assert.ok(engine.getRingBuffer("pe-db-01"));

      // Trigger L1 Heartbeat Poll
      await engine.triggerPoll("pe-db-01", "L1");
      assert.strictEqual(heartbeatEvents.length, 1);
      assert.strictEqual(heartbeatEvents[0].endpointId, "pe-db-01");

      // Trigger L2 Telemetry Poll
      await engine.triggerPoll("pe-db-01", "L2");
      assert.ok(telemetryEvents.length >= 2);

      const ringBuffer = engine.getRingBuffer("pe-db-01")!;
      assert.strictEqual(ringBuffer.size, 2);

      const stats = engine.getEngineStats();
      assert.strictEqual(stats.totalEndpoints, 1);
      assert.strictEqual(stats.activeEndpoints, 1);
      assert.ok(stats.totalPollsExecuted >= 2);

      engine.stop();
    });
  });
});
