import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { BoundedWorkerPool } from "../../src/server/polling/BoundedWorkerPool";
import { EndpointCircuitBreaker } from "../../src/server/polling/CircuitBreaker";
import { TelemetryRingBuffer } from "../../src/server/polling/TelemetryRingBuffer";
import { CircuitState, PollingEndpoint, TelemetrySample } from "../../src/types/polling";
import { DBInstance, DatabaseEngine } from "../../src/types/dba";

interface SimulatedEndpoint {
  id: string;
  name: string;
  zone: "us-east-dc" | "us-west-cloud" | "eu-west-cloud" | "apac-prod";
  engine: DatabaseEngine;
  baseLatencyMs: number;
  failureRate: number;
}

function generateSimulatedFleet(count: number = 110): SimulatedEndpoint[] {
  const zones: Array<"us-east-dc" | "us-west-cloud" | "eu-west-cloud" | "apac-prod"> = [
    "us-east-dc",
    "us-west-cloud",
    "eu-west-cloud",
    "apac-prod",
  ];
  const engines: DatabaseEngine[] = ["Oracle", "PostgreSQL", "SQL Server", "MySQL"];

  const fleet: SimulatedEndpoint[] = [];
  for (let i = 1; i <= count; i++) {
    const zone = zones[(i - 1) % zones.length];
    const engine = engines[(i - 1) % engines.length];
    const baseLatencyMs =
      zone === "us-east-dc"
        ? 5 + (i % 5)
        : zone === "us-west-cloud"
        ? 15 + (i % 10)
        : zone === "eu-west-cloud"
        ? 25 + (i % 10)
        : 45 + (i % 15);

    fleet.push({
      id: `ep-sim-${zone}-${i.toString().padStart(3, "0")}`,
      name: `Simulated ${engine} Node ${i}`,
      zone,
      engine,
      baseLatencyMs,
      failureRate: 0.0,
    });
  }
  return fleet;
}

describe("High-Concurrency Polling Load & Resilience Suite (100+ Endpoints)", () => {
  const fleet = generateSimulatedFleet(110);

  it("Scale Test 1: should execute concurrent polling across 110 endpoints in 4 zones with BoundedWorkerPool", async () => {
    const zonePools = new Map<string, BoundedWorkerPool>();
    const zones = ["us-east-dc", "us-west-cloud", "eu-west-cloud", "apac-prod"];
    for (const z of zones) {
      zonePools.set(z, new BoundedWorkerPool(z, 10, 200));
    }

    const start = Date.now();
    const pollPromises = fleet.map((ep) => {
      const pool = zonePools.get(ep.zone)!;
      return pool.run(ep.id, async () => {
        await new Promise((r) => setTimeout(r, Math.min(15, ep.baseLatencyMs)));
        return {
          endpointId: ep.id,
          zone: ep.zone,
          engine: ep.engine,
          collectedAt: new Date().toISOString(),
          status: "ONLINE",
        };
      }, 2);
    });

    const results = await Promise.all(pollPromises);
    const duration = Date.now() - start;

    assert.strictEqual(results.length, 110);
    assert.ok(duration < 2500, `Expected 110 polls to complete in <2500ms, took ${duration}ms`);

    for (const z of zones) {
      const pool = zonePools.get(z)!;
      assert.strictEqual(pool.stats.activeWorkers, 0);
      assert.strictEqual(pool.stats.queuedTasks, 0);
      assert.ok(pool.stats.totalExecuted >= 25);
    }
  });

  it("Event Loop Stability Test 2: monitorEventLoopDelay under 5 sustained polling cycles of 110 endpoints", async () => {
    const loopMonitor = monitorEventLoopDelay({ resolution: 10 });
    loopMonitor.enable();

    const zonePools = new Map<string, BoundedWorkerPool>();
    for (const z of ["us-east-dc", "us-west-cloud", "eu-west-cloud", "apac-prod"]) {
      zonePools.set(z, new BoundedWorkerPool(z, 10, 300));
    }

    // 5 complete rounds across all 110 endpoints (550 total polling operations)
    for (let round = 1; round <= 5; round++) {
      const roundPromises = fleet.map((ep) => {
        const pool = zonePools.get(ep.zone)!;
        return pool.run(ep.id, async () => {
          // Simulated DB metric calculation
          const cpu = 20 + Math.random() * 60;
          const memory = 40 + Math.random() * 40;
          await new Promise((r) => setTimeout(r, 5));
          return { cpu, memory };
        }, 2);
      });
      await Promise.all(roundPromises);
    }

    loopMonitor.disable();

    const meanMs = loopMonitor.mean / 1e6;
    const maxMs = loopMonitor.max / 1e6;
    const p95Ms = loopMonitor.percentile(95) / 1e6;

    assert.ok(meanMs < 20.0, `Expected event loop lag mean < 20.0ms, got ${meanMs.toFixed(2)}ms`);
    assert.ok(maxMs < 100.0, `Expected event loop lag max < 100.0ms, got ${maxMs.toFixed(2)}ms`);
    assert.ok(p95Ms < 50.0, `Expected event loop lag p95 < 50.0ms, got ${p95Ms.toFixed(2)}ms`);
  });

  it("Chaos Resilience Test 3: Circuit Breaker tripping under 30% simulated network drops", async () => {
    const breakers = new Map<string, EndpointCircuitBreaker>();
    const dropRate = 0.3; // 30% drop
    const dropTargets = new Set(
      fleet.slice(0, Math.floor(fleet.length * dropRate)).map((e) => e.id)
    );

    for (const ep of fleet) {
      breakers.set(
        ep.id,
        new EndpointCircuitBreaker(ep.id, {
          failureThreshold: 3,
          baseResetTimeoutMs: 50,
          jitterFactor: 0.1,
          executionTimeoutMs: 500,
        })
      );
    }

    // Execute 4 polling rounds with chaos injection
    for (let round = 1; round <= 4; round++) {
      const pollTasks = fleet.map(async (ep) => {
        const cb = breakers.get(ep.id)!;
        const willFail = dropTargets.has(ep.id);

        return cb.execute(
          async () => {
            if (willFail) {
              throw new Error("ECONNRESET: simulated connection reset by peer");
            }
            return "ok";
          },
          (fallback) => `fallback:${fallback}`
        );
      });

      await Promise.all(pollTasks);
    }

    // Assert that failing endpoints are now in OPEN state
    let openCount = 0;
    let closedCount = 0;

    for (const ep of fleet) {
      const cb = breakers.get(ep.id)!;
      if (dropTargets.has(ep.id)) {
        assert.strictEqual(cb.getState(), CircuitState.OPEN);
        openCount++;
      } else {
        assert.strictEqual(cb.getState(), CircuitState.CLOSED);
        closedCount++;
      }
    }

    assert.strictEqual(openCount, dropTargets.size);
    assert.strictEqual(closedCount, fleet.length - dropTargets.size);

    // Verify fast-fail in OPEN (< 1ms)
    const failingEp = Array.from(dropTargets)[0];
    const cb = breakers.get(failingEp)!;
    const fastFailStart = Date.now();
    const fallbackRes = await cb.execute(
      () => Promise.resolve("should_not_run"),
      (reason) => reason
    );
    const fastFailDuration = Date.now() - fastFailStart;

    assert.ok(fastFailDuration < 10);
    assert.ok(fallbackRes.includes("Fast-failing"));
  });

  it("Zone Isolation Test 4: 100% failure on us-east-dc does not affect other zones", async () => {
    const zonePools = new Map<string, BoundedWorkerPool>();
    for (const z of ["us-east-dc", "us-west-cloud", "eu-west-cloud", "apac-prod"]) {
      zonePools.set(z, new BoundedWorkerPool(z, 10, 200));
    }

    const breakers = new Map<string, EndpointCircuitBreaker>();
    for (const ep of fleet) {
      breakers.set(ep.id, new EndpointCircuitBreaker(ep.id, { failureThreshold: 2, baseResetTimeoutMs: 100 }));
    }

    // Execute poll: us-east-dc fails 100%, all others succeed
    const pollPromises = fleet.map(async (ep) => {
      const pool = zonePools.get(ep.zone)!;
      const cb = breakers.get(ep.id)!;

      return pool.run(
        ep.id,
        async () => {
          return cb.execute(
            async () => {
              if (ep.zone === "us-east-dc") {
                throw new Error("Datacenter power partition");
              }
              await new Promise((r) => setTimeout(r, 5));
              return "success";
            },
            (err) => `handled:${err}`
          );
        },
        2
      );
    });

    const results = await Promise.all(pollPromises);
    assert.strictEqual(results.length, 110);

    // Verify other zones completed 100% cleanly
    const otherZoneResults = results.filter((_, idx) => fleet[idx].zone !== "us-east-dc");
    assert.ok(otherZoneResults.every((r) => r === "success"));

    const eastPool = zonePools.get("us-east-dc")!;
    assert.strictEqual(eastPool.stats.activeWorkers, 0);

    const westPool = zonePools.get("us-west-cloud")!;
    assert.strictEqual(westPool.stats.activeWorkers, 0);
    assert.ok(westPool.stats.totalExecuted >= 25);
  });

  it("Memory Containment Test 5: 110 ring buffers bounded at 60 capacity across 11,000 pushes", () => {
    const buffers = new Map<string, TelemetryRingBuffer<TelemetrySample>>();
    for (const ep of fleet) {
      buffers.set(ep.id, new TelemetryRingBuffer<TelemetrySample>(60));
    }

    const initialHeap = process.memoryUsage().heapUsed;

    // Push 100 samples per endpoint (11,000 total pushes)
    for (let sampleIdx = 1; sampleIdx <= 100; sampleIdx++) {
      for (const ep of fleet) {
        const buf = buffers.get(ep.id)!;
        buf.push({
          instanceId: ep.id,
          timestamp: new Date().toISOString(),
          cpu: 25.0 + (sampleIdx % 50),
          memory: 45.0 + (sampleIdx % 40),
          iops: 500 + sampleIdx * 10,
          activeConnections: 30 + (sampleIdx % 20),
          maxConnections: 500,
          queryLatencyMs: 4.5,
          slowQueryCount: 0,
          replicationLagSeconds: 0,
          bufferHitRatio: 99.1,
          deadlocksCount: 0,
          diskFreeGb: 400,
          diskTotalGb: 1000,
        });
      }
    }

    const finalHeap = process.memoryUsage().heapUsed;
    const heapGrowthMb = (finalHeap - initialHeap) / (1024 * 1024);

    // Verify all 110 ring buffers strictly respect capacity of 60
    for (const ep of fleet) {
      const buf = buffers.get(ep.id)!;
      assert.strictEqual(buf.size, 60);
      assert.strictEqual(buf.toArray().length, 60);
      assert.ok(buf.latest);
      assert.strictEqual(buf.latest.instanceId, ep.id);
    }

    // Assert memory footprint growth is bounded (< 25MB)
    assert.ok(
      heapGrowthMb < 25.0,
      `Expected heap growth < 25MB for 110 ring buffers, got ${heapGrowthMb.toFixed(2)}MB`
    );
  });
});
