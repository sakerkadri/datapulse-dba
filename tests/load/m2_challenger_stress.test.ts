import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { TelemetryRingBuffer } from "../../src/server/polling/TelemetryRingBuffer";
import { TieredScheduler } from "../../src/server/polling/TieredScheduler";
import { PollingEngine } from "../../src/server/polling/PollingEngine";
import {
  CircuitState,
  CircuitStateEvent,
  HeartbeatEvent,
  IEndpointCollector,
  PollingEndpoint,
  TelemetryDeltaEvent,
  TelemetrySample,
} from "../../src/types/polling";
import type { DatabaseEngine, DBInstance, IncidentAlert } from "../../src/types/dba";

// Helper to force Garbage Collection if available
function runGc() {
  if (typeof (global as any).gc === "function") {
    (global as any).gc();
  }
}

describe("Milestone 2 Adversarial Stress & Empirical Verification Suite", () => {
  describe("1. Ring Buffer Memory Containment & Math Correctness", () => {
    it("should instantiate 200 TelemetryRingBuffers, push 100,000 samples each (20M total), and bound heap growth < 15MB", async () => {
      runGc();
      const initialMem = process.memoryUsage().heapUsed;

      const NUM_BUFFERS = 200;
      const SAMPLES_PER_BUFFER = 100_000;
      const CAPACITY = 60;

      const buffers: TelemetryRingBuffer<TelemetrySample>[] = [];
      for (let i = 0; i < NUM_BUFFERS; i++) {
        buffers.push(new TelemetryRingBuffer<TelemetrySample>(CAPACITY));
      }

      const startPushTime = Date.now();

      // Push 100k samples into each of the 200 buffers
      for (let i = 0; i < NUM_BUFFERS; i++) {
        const buf = buffers[i];
        const instId = `inst-perf-${i.toString().padStart(3, "0")}`;

        for (let s = 0; s < SAMPLES_PER_BUFFER; s++) {
          buf.push({
            instanceId: instId,
            timestamp: "2026-08-19T12:00:00.000Z",
            cpu: (s % 100) + 0.5,
            memory: ((s * 3) % 80) + 10,
            iops: (s * 7) % 3000,
            activeConnections: (s % 50) + 1,
            maxConnections: 100,
            queryLatencyMs: (s % 20) + 1.2,
            slowQueryCount: s % 5 === 0 ? 1 : 0,
            replicationLagSeconds: 0,
            bufferHitRatio: 99.1,
            deadlocksCount: 0,
            diskFreeGb: 200,
            diskTotalGb: 500,
          });
        }
      }

      const pushDuration = Date.now() - startPushTime;
      console.log(
        `[Stress Test] Pushed ${NUM_BUFFERS * SAMPLES_PER_BUFFER} samples across ${NUM_BUFFERS} buffers in ${pushDuration}ms (${(
          (NUM_BUFFERS * SAMPLES_PER_BUFFER) /
          (pushDuration / 1000)
        ).toFixed(0)} ops/sec)`
      );

      // Verify all buffers are strictly at capacity
      for (let i = 0; i < NUM_BUFFERS; i++) {
        assert.strictEqual(buffers[i].size, CAPACITY, `Buffer ${i} size must be exactly ${CAPACITY}`);
        assert.strictEqual(buffers[i].toArray().length, CAPACITY, `Buffer ${i} toArray() length must be ${CAPACITY}`);
        assert.ok(buffers[i].latest !== null, `Buffer ${i} latest must not be null`);
      }

      runGc();
      const finalMem = process.memoryUsage().heapUsed;
      const heapGrowthBytes = finalMem - initialMem;
      const heapGrowthMb = Number((heapGrowthBytes / (1024 * 1024)).toFixed(2));

      console.log(
        `[Memory Benchmark] Initial Heap: ${(initialMem / 1024 / 1024).toFixed(2)} MB | Final Heap: ${(
          finalMem / 1024 / 1024
        ).toFixed(2)} MB | Heap Growth: ${heapGrowthMb} MB`
      );

      // Memory constraint: Must remain strictly bounded < 15MB total heap growth
      assert.ok(
        heapGrowthMb < 15.0,
        `Retained heap growth was ${heapGrowthMb} MB, which violates the < 15 MB containment bound`
      );
    });

    it("should compute mathematical rolling statistics (min, max, avg, p95) matching reference oracle math across edge cases", () => {
      // Deterministic PRNG for reproducibility
      let seed = 123456789;
      function pseudoRandom() {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      }

      const testLengths = [1, 2, 5, 20, 59, 60, 61, 100, 500, 10000];

      for (const length of testLengths) {
        const buffer = new TelemetryRingBuffer<{ cpu: number; timestamp?: string }>(60);
        const allSamples: number[] = [];

        for (let i = 0; i < length; i++) {
          const val = Number((pseudoRandom() * 100).toFixed(2));
          allSamples.push(val);
          buffer.push({ cpu: val, timestamp: new Date().toISOString() });
        }

        // Oracle calculation on window of last min(length, 60) elements
        const windowSize = Math.min(length, 60);
        const windowSamples = allSamples.slice(allSamples.length - windowSize);

        const oracleMin = Math.min(...windowSamples);
        const oracleMax = Math.max(...windowSamples);
        const sum = windowSamples.reduce((a, b) => a + b, 0);
        const oracleAvg = Number((sum / windowSamples.length).toFixed(2));
        const oracleLatest = windowSamples[windowSamples.length - 1];

        const sorted = [...windowSamples].sort((a, b) => a - b);
        const p95Idx = Math.floor(sorted.length * 0.95);
        const oracleP95 = sorted[Math.min(sorted.length - 1, p95Idx)];

        const stats = buffer.getRollingStats((s) => s.cpu);

        assert.strictEqual(stats.count, windowSize, `Count mismatch for length ${length}`);
        assert.strictEqual(stats.min, Number(oracleMin.toFixed(2)), `Min mismatch for length ${length}`);
        assert.strictEqual(stats.max, Number(oracleMax.toFixed(2)), `Max mismatch for length ${length}`);
        assert.strictEqual(stats.avg, oracleAvg, `Avg mismatch for length ${length}`);
        assert.strictEqual(stats.latest, Number(oracleLatest.toFixed(2)), `Latest mismatch for length ${length}`);
        assert.strictEqual(stats.p95, Number(oracleP95.toFixed(2)), `P95 mismatch for length ${length}`);
      }
    });

    it("should handle edge cases: zero capacity rejection, empty buffer zero-stats, NaN values, identical values", () => {
      // 1. Zero/Negative capacity validation
      assert.throws(() => new TelemetryRingBuffer(0), /RingBuffer capacity must be > 0/);
      assert.throws(() => new TelemetryRingBuffer(-5), /RingBuffer capacity must be > 0/);

      // 2. Empty buffer stats
      const emptyBuf = new TelemetryRingBuffer<TelemetrySample>(60);
      const emptyStats = emptyBuf.getRollingStats((s) => s.cpu);
      assert.deepStrictEqual(emptyStats, { min: 0, max: 0, avg: 0, latest: 0, p95: 0, count: 0 });

      // 3. Buffer with identical values
      const constBuf = new TelemetryRingBuffer<{ val: number; timestamp?: string }>(10);
      for (let i = 0; i < 20; i++) constBuf.push({ val: 42.5 });
      const constStats = constBuf.getRollingStats((s) => s.val);
      assert.strictEqual(constStats.min, 42.5);
      assert.strictEqual(constStats.max, 42.5);
      assert.strictEqual(constStats.avg, 42.5);
      assert.strictEqual(constStats.p95, 42.5);
      assert.strictEqual(constStats.count, 10);

      // 4. Buffer with NaN / undefined values filtered cleanly
      const dirtyBuf = new TelemetryRingBuffer<{ val?: number; timestamp?: string }>(10);
      dirtyBuf.push({ val: 10 });
      dirtyBuf.push({ val: NaN });
      dirtyBuf.push({ val: (undefined as any) });
      dirtyBuf.push({ val: 20 });
      const dirtyStats = dirtyBuf.getRollingStats((s) => s.val || 0);
      assert.strictEqual(dirtyStats.count, 4); // 10, 0, 0, 20
      assert.strictEqual(dirtyStats.min, 0);
      assert.strictEqual(dirtyStats.max, 20);
      assert.strictEqual(dirtyStats.avg, 7.5);
    });
  });

  describe("2. TieredScheduler & Dynamic Adaptive Throttling", () => {
    it("should register 100 endpoints and assign distributed phase offsets preventing dispatch stampedes", () => {
      const dispatched: string[] = [];
      const scheduler = new TieredScheduler(async (ep, tier) => {
        dispatched.push(`${ep.id}:${tier}`);
      }, 50);

      const NUM_ENDPOINTS = 100;
      for (let i = 0; i < NUM_ENDPOINTS; i++) {
        const ep: PollingEndpoint = {
          id: `ep-${i.toString().padStart(3, "0")}`,
          name: `DB ${i}`,
          engine: (i % 4 === 0 ? "Oracle" : i % 4 === 1 ? "PostgreSQL" : i % 4 === 2 ? "MySQL" : "SQL Server") as DatabaseEngine,
          host: `10.0.0.${i}`,
          port: 1521,
          databaseName: `DB_${i}`,
          zone: i < 33 ? "us-east-1" : i < 66 ? "eu-west-1" : "ap-southeast-1",
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
        };
        scheduler.registerEndpoint(ep);
      }

      assert.strictEqual(scheduler.registeredEndpointsCount, 100);

      // Verify phase offsets distribution across the 100 endpoints
      const states = Array.from({ length: 100 }, (_, i) =>
        scheduler.getEndpointState(`ep-${i.toString().padStart(3, "0")}`)!
      );

      for (let i = 0; i < 100; i++) {
        const state = states[i];
        assert.ok(state, `State for ep-${i} must exist`);
        assert.strictEqual(state.phaseOffsetMs.L1, (i * 250) % 5000);
        assert.strictEqual(state.phaseOffsetMs.L2, (i * 1000) % 30000);
        assert.strictEqual(state.phaseOffsetMs.L3, (i * 5000) % 300000);
      }
    });

    it("should dynamically double L3 cadence under CPU > 90% and restore nominal cadence after exactly 2 recovery ticks", () => {
      const dispatched: { id: string; tier: string }[] = [];
      const scheduler = new TieredScheduler(async (ep, tier) => {
        dispatched.push({ id: ep.id, tier });
      });

      const ep: PollingEndpoint = {
        id: "adaptive-test-ep",
        name: "Adaptive DB",
        engine: "Oracle",
        host: "localhost",
        port: 1521,
        databaseName: "ORCL",
        zone: "us-east-1",
        enabled: true,
        cadenceConfig: {
          l1IntervalMs: 5000,
          l2IntervalMs: 30000,
          l3IntervalMs: 300000, // 5 min
          adaptiveThrottlingEnabled: true,
          adaptiveCpuThresholdPct: 90,
          adaptiveConnThresholdPct: 90,
          adaptiveL3Multiplier: 2.0, // 10 min when throttled
        },
      };

      scheduler.registerEndpoint(ep);
      const state = scheduler.getEndpointState("adaptive-test-ep")!;
      assert.strictEqual(state.isThrottled, false);
      assert.strictEqual(state.recoveryTickCount, 0);

      // Step 1: Normal load -> No throttling
      scheduler.updateLoadMetrics("adaptive-test-ep", 65.0, 40.0);
      assert.strictEqual(state.isThrottled, false);
      assert.strictEqual(state.recoveryTickCount, 0);

      // Step 2: Sudden CPU spike (94.2% >= 90%)
      scheduler.updateLoadMetrics("adaptive-test-ep", 94.2, 50.0);
      assert.strictEqual(state.isThrottled, true, "Endpoint must transition to throttled on CPU >= 90%");
      assert.strictEqual(state.recoveryTickCount, 0);

      // Step 3: Repeated high CPU keeps throttling active and resets recovery
      scheduler.updateLoadMetrics("adaptive-test-ep", 91.0, 55.0);
      assert.strictEqual(state.isThrottled, true);
      assert.strictEqual(state.recoveryTickCount, 0);

      // Step 4: Recovery Tick 1 (CPU drops to 45%) -> Must STILL BE THROTTLED
      scheduler.updateLoadMetrics("adaptive-test-ep", 45.0, 30.0);
      assert.strictEqual(state.isThrottled, true, "Endpoint must stay throttled on recovery tick 1 (hysteresis)");
      assert.strictEqual(state.recoveryTickCount, 1);

      // Step 5: Adversarial Re-spike during recovery (CPU back to 93%) -> Must reset recovery counter
      scheduler.updateLoadMetrics("adaptive-test-ep", 93.0, 50.0);
      assert.strictEqual(state.isThrottled, true);
      assert.strictEqual(state.recoveryTickCount, 0, "Recovery counter must reset to 0 upon re-spike");

      // Step 6: Recovery Tick 1 again (CPU drops to 40%)
      scheduler.updateLoadMetrics("adaptive-test-ep", 40.0, 20.0);
      assert.strictEqual(state.isThrottled, true);
      assert.strictEqual(state.recoveryTickCount, 1);

      // Step 7: Recovery Tick 2 (CPU stays normal 38%) -> MUST RECOVER TO UNTHROTTLED
      scheduler.updateLoadMetrics("adaptive-test-ep", 38.0, 18.0);
      assert.strictEqual(state.isThrottled, false, "Endpoint must recover to unthrottled after exactly 2 consecutive normal ticks");
      assert.strictEqual(state.recoveryTickCount, 0);
    });

    it("should throttle on connection saturation (conn >= 90%) as well as CPU", () => {
      const scheduler = new TieredScheduler(async () => {});
      scheduler.registerEndpoint({
        id: "conn-throttle-ep",
        name: "Conn Sat DB",
        engine: "PostgreSQL",
        host: "localhost",
        port: 5432,
        databaseName: "postgres",
        zone: "eu-west-1",
        enabled: true,
      });

      const state = scheduler.getEndpointState("conn-throttle-ep")!;
      assert.strictEqual(state.isThrottled, false);

      // Normal CPU (30%), High Connection Usage (95%)
      scheduler.updateLoadMetrics("conn-throttle-ep", 30.0, 95.0);
      assert.strictEqual(state.isThrottled, true);

      // 2 Normal ticks to recover
      scheduler.updateLoadMetrics("conn-throttle-ep", 30.0, 50.0);
      assert.strictEqual(state.isThrottled, true);
      scheduler.updateLoadMetrics("conn-throttle-ep", 30.0, 45.0);
      assert.strictEqual(state.isThrottled, false);
    });
  });

  describe("3. PollingEngine & SSE Event Emission Pipeline", () => {
    it("should coordinate multi-zone endpoints, trigger poll cycles, and verify event emission", async () => {
      const engine = new PollingEngine({
        defaultZoneConcurrency: 5,
        bufferCapacity: 60,
        circuitBreakerThreshold: 3,
        baseResetTimeoutMs: 100,
        executionTimeoutMs: 500,
      });

      const emittedEvents = {
        telemetry_delta: [] as TelemetryDeltaEvent[],
        heartbeat: [] as HeartbeatEvent[],
        circuit_state: [] as CircuitStateEvent[],
        incident_fired: [] as IncidentAlert[],
      };

      engine.on("telemetry_delta", (e) => emittedEvents.telemetry_delta.push(e));
      engine.on("heartbeat", (e) => emittedEvents.heartbeat.push(e));
      engine.on("circuit_state", (e) => emittedEvents.circuit_state.push(e));
      engine.on("incident_fired", (e) => emittedEvents.incident_fired.push(e));

      // Mock Collector returning known telemetry
      let mockFail = false;
      const mockCollector: IEndpointCollector = {
        collectL1: async (ep) => ({
          uptimeSeconds: 7200,
          queryLatencyMs: 4.5,
        }),
        collectL2: async (ep) => {
          if (mockFail) throw new Error("Simulated Oracle Connection Error ORA-03113");
          return {
            cpuUsage: 35.5,
            memoryUsage: 55.0,
            iops: 1250,
            activeConnections: 42,
            queryLatencyMs: 6.8,
            bufferHitRatio: 99.4,
          };
        },
        collectL3: async (ep) => ({
          diskFreeGb: 350,
          diskTotalGb: 1000,
          slowQueryCount: 2,
        }),
      };

      engine.registerCollector("Oracle", mockCollector);

      // Register 6 endpoints across 3 zones
      const zones = ["us-east-1", "eu-west-1", "ap-southeast-1"];
      for (let i = 1; i <= 6; i++) {
        const zone = zones[(i - 1) % 3];
        engine.registerEndpoint({
          id: `db-zone-${i}`,
          name: `DB ${i}`,
          engine: "Oracle",
          host: `10.10.0.${i}`,
          port: 1521,
          databaseName: `ORCL_${i}`,
          zone,
          enabled: true,
        });
      }

      // 1. Verify zone worker pools created
      assert.ok(engine.getZonePool("us-east-1"));
      assert.ok(engine.getZonePool("eu-west-1"));
      assert.ok(engine.getZonePool("ap-southeast-1"));

      // 2. Trigger L1 Heartbeat polls across all 6 endpoints
      for (let i = 1; i <= 6; i++) {
        await engine.triggerPoll(`db-zone-${i}`, "L1");
      }

      assert.strictEqual(emittedEvents.heartbeat.length, 6);
      assert.strictEqual(emittedEvents.telemetry_delta.length, 6);

      // 3. Trigger L2 Telemetry polls across all 6 endpoints
      for (let i = 1; i <= 6; i++) {
        await engine.triggerPoll(`db-zone-${i}`, "L2");
      }

      assert.strictEqual(emittedEvents.telemetry_delta.length, 12);

      // 4. Verify ring buffer population
      for (let i = 1; i <= 6; i++) {
        const ring = engine.getRingBuffer(`db-zone-${i}`)!;
        assert.strictEqual(ring.size, 2); // 1 L1 + 1 L2
        assert.strictEqual(ring.latest?.cpu, 35.5);
        assert.strictEqual(ring.latest?.activeConnections, 42);
      }

      // 5. Test Circuit Breaker Trip & Incident Event Emission
      mockFail = true;
      const targetEp = "db-zone-1";

      // Fail 1
      await engine.triggerPoll(targetEp, "L2");
      assert.strictEqual(engine.getCircuitBreaker(targetEp)?.getState(), CircuitState.CLOSED);

      // Fail 2
      await engine.triggerPoll(targetEp, "L2");
      assert.strictEqual(engine.getCircuitBreaker(targetEp)?.getState(), CircuitState.CLOSED);

      // Fail 3 -> Circuit Trips to OPEN -> Emits circuit_state and incident_fired
      await engine.triggerPoll(targetEp, "L2");
      assert.strictEqual(engine.getCircuitBreaker(targetEp)?.getState(), CircuitState.OPEN);

      assert.ok(emittedEvents.incident_fired.length >= 1, "incident_fired event must be emitted on circuit trip");
      const firedIncident = emittedEvents.incident_fired.find((inc) => inc.databaseId === targetEp);
      assert.ok(firedIncident, `Incident alert for ${targetEp} must be emitted`);
      assert.strictEqual(firedIncident.severity, "CRITICAL");
      assert.strictEqual(firedIncident.ruleId, "CIRCUIT_BREAKER_TRIPPED");

      const cbStateEvent = emittedEvents.circuit_state.find(
        (evt) => evt.endpointId === targetEp && evt.state === CircuitState.OPEN
      );
      assert.ok(cbStateEvent, `CircuitStateEvent for ${targetEp} [OPEN] must be emitted`);

      // 6. Test Fast-Failing while OPEN
      const openStart = Date.now();
      await engine.triggerPoll(targetEp, "L2");
      const openElapsed = Date.now() - openStart;
      assert.ok(openElapsed < 20, `Fast failing in OPEN state took ${openElapsed}ms, expected < 20ms`);

      // 7. Verify Engine Stats Aggregation
      const stats = engine.getEngineStats();
      assert.strictEqual(stats.totalEndpoints, 6);
      assert.strictEqual(stats.activeEndpoints, 5); // 5 closed, 1 open
      assert.strictEqual(stats.circuitBreakers.open, 1);
      assert.strictEqual(stats.circuitBreakers.closed, 5);
      assert.deepStrictEqual(stats.circuitBreakers.trippedEndpoints, ["db-zone-1"]);
      assert.strictEqual(stats.zones.length, 3);
      assert.ok(stats.totalPollsExecuted >= 12);
      assert.ok(stats.totalPollErrors >= 3);
      assert.strictEqual(stats.ringBufferMemoryBytes, 6 * 60 * 350);

      // 8. Cooldown & Half-Open Recovery
      mockFail = false;
      await new Promise((r) => setTimeout(r, 120)); // wait for 100ms baseResetTimeoutMs
      assert.strictEqual(engine.getCircuitBreaker(targetEp)?.getState(), CircuitState.HALF_OPEN);

      // Successful probe in HALF_OPEN recovers to CLOSED
      await engine.triggerPoll(targetEp, "L2");
      assert.strictEqual(engine.getCircuitBreaker(targetEp)?.getState(), CircuitState.CLOSED);

      const recoveredCbEvent = emittedEvents.circuit_state.find(
        (evt) => evt.endpointId === targetEp && evt.state === CircuitState.CLOSED
      );
      assert.ok(recoveredCbEvent, "Circuit recovery event must be emitted");

      engine.stop();
    });

    it("should handle Express SSE Telemetry Streaming endpoint with initial snapshot, live deltas, filters, and clean unsubscription", async () => {
      const engine = new PollingEngine({ defaultZoneConcurrency: 5 });
      engine.registerEndpoint({
        id: "sse-db-1",
        name: "SSE DB 1",
        engine: "Oracle",
        host: "localhost",
        port: 1521,
        databaseName: "ORCL",
        zone: "us-east-1",
        enabled: true,
      });
      engine.registerEndpoint({
        id: "sse-db-2",
        name: "SSE DB 2",
        engine: "PostgreSQL",
        host: "localhost",
        port: 5432,
        databaseName: "PG",
        zone: "eu-west-1",
        enabled: true,
      });

      const sseApp = express();

      // Implement SSE route equivalent to server.ts
      sseApp.get("/api/stream/telemetry", (req, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");

        const targetId = req.query.targetId as string | undefined;
        const zone = req.query.zone as string | undefined;

        let instances = engine.getLatestInstances();
        if (targetId && targetId !== "ALL") {
          instances = instances.filter((inst) => inst.id === targetId);
        }
        if (zone) {
          instances = instances.filter((inst) => {
            const ep = engine.getEndpoint(inst.id);
            return ep?.zone === zone;
          });
        }

        res.write(`event: snapshot\ndata: ${JSON.stringify({ instances, timestamp: new Date().toISOString() })}\n\n`);

        const onDelta = (evt: TelemetryDeltaEvent) => {
          if (targetId && targetId !== "ALL" && evt.instanceId !== targetId) return;
          if (zone) {
            const ep = engine.getEndpoint(evt.instanceId);
            if (ep?.zone !== zone) return;
          }
          res.write(`event: telemetry_delta\ndata: ${JSON.stringify(evt)}\n\n`);
        };

        engine.on("telemetry_delta", onDelta);

        req.on("close", () => {
          engine.off("telemetry_delta", onDelta);
          res.end();
        });
      });

      const server = http.createServer(sseApp);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      const initialListenerCount = engine.listenerCount("telemetry_delta");

      // 1. Connect SSE Client filtered to targetId=sse-db-1
      const receivedChunks: string[] = [];
      const clientReq = http.get(`http://127.0.0.1:${port}/api/stream/telemetry?targetId=sse-db-1`, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers["content-type"], "text/event-stream");

        res.on("data", (chunk) => {
          receivedChunks.push(chunk.toString());
        });
      });

      // Wait for handshake
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(engine.listenerCount("telemetry_delta"), initialListenerCount + 1);

      // Verify Snapshot frame received
      const initialPayload = receivedChunks.join("");
      assert.ok(initialPayload.includes("event: snapshot"), "Snapshot event must be received on connection");
      assert.ok(initialPayload.includes("sse-db-1"), "Snapshot must include sse-db-1");
      assert.ok(!initialPayload.includes("sse-db-2"), "Snapshot filtered by targetId must NOT include sse-db-2");

      // 2. Trigger Poll on sse-db-2 (should be filtered out by client stream)
      await engine.triggerPoll("sse-db-2", "L2");
      await new Promise((r) => setTimeout(r, 30));
      const midPayload = receivedChunks.join("");
      assert.ok(!midPayload.includes('"instanceId":"sse-db-2"'), "sse-db-2 delta must be filtered out for targetId=sse-db-1");

      // 3. Trigger Poll on sse-db-1 (should be delivered to client stream)
      await engine.triggerPoll("sse-db-1", "L2");
      await new Promise((r) => setTimeout(r, 30));
      const finalPayload = receivedChunks.join("");
      assert.ok(finalPayload.includes("event: telemetry_delta"), "telemetry_delta event must be delivered");
      assert.ok(finalPayload.includes('"instanceId":"sse-db-1"'), "sse-db-1 delta must be delivered");

      // 4. Close client connection and verify listener cleanup
      clientReq.destroy();
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(
        engine.listenerCount("telemetry_delta"),
        initialListenerCount,
        "Listener count must return to baseline after client disconnect"
      );

      server.close();
      engine.stop();
    });
  });
});
