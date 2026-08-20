import { EventEmitter } from "events";
import { DBInstance, IncidentAlert, DatabaseEngine } from "../../types/dba";
import {
  CadenceTier,
  CircuitState,
  CircuitStateEvent,
  EngineStats,
  HeartbeatEvent,
  IEndpointCollector,
  PollingEndpoint,
  TelemetryDeltaEvent,
  TelemetrySample,
} from "../../types/polling";
import { BoundedWorkerPool } from "./BoundedWorkerPool";
import { EndpointCircuitBreaker } from "./CircuitBreaker";
import { TieredScheduler } from "./TieredScheduler";
import { TelemetryRingBuffer } from "./TelemetryRingBuffer";

export interface PollingEngineOptions {
  defaultZoneConcurrency?: number;
  bufferCapacity?: number;
  circuitBreakerThreshold?: number;
  baseResetTimeoutMs?: number;
  executionTimeoutMs?: number;
}

export class PollingEngine extends EventEmitter {
  private zonePools: Map<string, BoundedWorkerPool> = new Map();
  private circuitBreakers: Map<string, EndpointCircuitBreaker> = new Map();
  private ringBuffers: Map<string, TelemetryRingBuffer<TelemetrySample>> = new Map();
  private collectors: Map<string, IEndpointCollector> = new Map();
  private latestInstances: Map<string, DBInstance> = new Map();
  private endpoints: Map<string, PollingEndpoint> = new Map();
  private scheduler: TieredScheduler;

  private totalPolls = 0;
  private totalErrors = 0;
  private startTime = Date.now();

  constructor(private readonly options: PollingEngineOptions = {}) {
    super();
    this.scheduler = new TieredScheduler(
      (endpoint, tier) => this.executeScheduledPoll(endpoint, tier)
    );
  }

  registerCollector(engineType: DatabaseEngine | string, collector: IEndpointCollector): void {
    this.collectors.set(engineType, collector);
  }

  registerEndpoint(endpoint: PollingEndpoint, initialData?: DBInstance): void {
    this.endpoints.set(endpoint.id, endpoint);
    const zone = endpoint.zone || "default-zone";

    if (!this.zonePools.has(zone)) {
      this.zonePools.set(
        zone,
        new BoundedWorkerPool(zone, this.options.defaultZoneConcurrency || 10)
      );
    }

    if (!this.circuitBreakers.has(endpoint.id)) {
      this.circuitBreakers.set(
        endpoint.id,
        new EndpointCircuitBreaker(endpoint.id, {
          failureThreshold: this.options.circuitBreakerThreshold || 3,
          baseResetTimeoutMs: this.options.baseResetTimeoutMs || 10000,
          maxResetTimeoutMs: 300000,
          jitterFactor: 0.25,
          executionTimeoutMs: this.options.executionTimeoutMs || 5000,
        })
      );
    }

    if (!this.ringBuffers.has(endpoint.id)) {
      this.ringBuffers.set(
        endpoint.id,
        new TelemetryRingBuffer<TelemetrySample>(this.options.bufferCapacity || 60)
      );
    }

    if (initialData) {
      this.latestInstances.set(endpoint.id, initialData);
    } else if (!this.latestInstances.has(endpoint.id)) {
      this.latestInstances.set(endpoint.id, {
        id: endpoint.id,
        name: endpoint.name,
        engine: endpoint.engine,
        version: "1.0",
        host: endpoint.host,
        port: endpoint.port,
        databaseName: endpoint.databaseName,
        status: "ONLINE",
        uptimeSeconds: 3600,
        cpuUsage: 25.0,
        memoryUsage: 45.0,
        iops: 800,
        activeConnections: 35,
        maxConnections: 100,
        queryLatencyMs: 8.5,
        slowQueryCount: 0,
        diskFreeGb: 120,
        diskTotalGb: 500,
        replicationLagSeconds: 0,
        bufferHitRatio: 99.2,
        deadlocksCount: 0,
        lastHealthCheck: "Just now",
        engineSpecific: {},
      });
    }

    this.scheduler.registerEndpoint(endpoint);
  }

  unregisterEndpoint(endpointId: string): void {
    this.scheduler.unregisterEndpoint(endpointId);
    this.circuitBreakers.delete(endpointId);
    this.ringBuffers.delete(endpointId);
    this.latestInstances.delete(endpointId);
    this.endpoints.delete(endpointId);
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  pause(): void {
    this.scheduler.pause();
  }

  resume(): void {
    this.scheduler.resume();
  }

  async triggerPoll(endpointId: string, tier: CadenceTier = "L2"): Promise<void> {
    await this.scheduler.onDemandPoll(endpointId, tier);
  }

  getRingBuffer(endpointId: string): TelemetryRingBuffer<TelemetrySample> | undefined {
    return this.ringBuffers.get(endpointId);
  }

  getCircuitBreaker(endpointId: string): EndpointCircuitBreaker | undefined {
    return this.circuitBreakers.get(endpointId);
  }

  getZonePool(zone: string): BoundedWorkerPool | undefined {
    return this.zonePools.get(zone);
  }

  getEndpoint(endpointId: string): PollingEndpoint | undefined {
    return this.endpoints.get(endpointId);
  }

  getLatestInstances(): DBInstance[] {
    return Array.from(this.latestInstances.values());
  }

  getEngineStats(): EngineStats {
    const zones = Array.from(this.zonePools.values()).map((p) => p.stats);
    let closed = 0;
    let open = 0;
    let halfOpen = 0;
    const tripped: string[] = [];

    for (const [id, cb] of this.circuitBreakers.entries()) {
      const st = cb.getState();
      if (st === CircuitState.CLOSED) closed++;
      else if (st === CircuitState.OPEN) {
        open++;
        tripped.push(id);
      } else if (st === CircuitState.HALF_OPEN) halfOpen++;
    }

    const uptimeSec = Math.max(1, Math.floor((Date.now() - this.startTime) / 1000));
    const pollsPerSec = Number((this.totalPolls / uptimeSec).toFixed(2));

    return {
      status: this.scheduler.getStatus(),
      totalEndpoints: this.circuitBreakers.size,
      activeEndpoints: closed + halfOpen,
      totalPollsExecuted: this.totalPolls,
      totalPollErrors: this.totalErrors,
      pollsPerSecond: pollsPerSec,
      uptimeSeconds: uptimeSec,
      zones,
      circuitBreakers: { closed, open, halfOpen, trippedEndpoints: tripped },
      ringBufferMemoryBytes: this.ringBuffers.size * (this.options.bufferCapacity || 60) * 350,
    };
  }

  async executeScheduledPoll(endpoint: PollingEndpoint, tier: CadenceTier): Promise<void> {
    const zone = endpoint.zone || "default-zone";
    const pool = this.zonePools.get(zone);
    const breaker = this.circuitBreakers.get(endpoint.id);
    const collector = this.collectors.get(endpoint.engine);

    if (!pool || !breaker) return;

    const priority = tier === "L1" ? 3 : tier === "L2" ? 2 : 1;

    try {
      await pool.run(
        endpoint.id,
        async () => {
          const prevState = breaker.getState();

          const result = await breaker.execute(
            async () => {
              if (collector) {
                if (tier === "L1") return await collector.collectL1(endpoint);
                if (tier === "L2") return await collector.collectL2(endpoint);
                return await collector.collectL3(endpoint);
              }
              return this.generateSyntheticMetrics(endpoint, tier);
            },
            (fallbackReason) => {
              throw new Error(fallbackReason);
            }
          );

          this.totalPolls++;
          const currState = breaker.getState();
          if (currState !== prevState) {
            const evt: CircuitStateEvent = {
              endpointId: endpoint.id,
              state: currState,
              consecutiveFailures: breaker.status.consecutiveFailures,
              nextAttemptTimestamp: breaker.status.nextAttemptTimestamp,
            };
            this.emit("circuit_state", evt);
          }

          this.handlePollSuccess(endpoint, tier, result);
        },
        priority
      );
    } catch (err: any) {
      this.totalErrors++;
      this.handlePollFailure(endpoint, breaker, err);
    }
  }

  private handlePollSuccess(
    endpoint: PollingEndpoint,
    tier: CadenceTier,
    delta: Partial<DBInstance>
  ): void {
    const existing = this.latestInstances.get(endpoint.id) || {
      id: endpoint.id,
      name: endpoint.name,
      engine: endpoint.engine,
      version: "1.0",
      host: endpoint.host,
      port: endpoint.port,
      databaseName: endpoint.databaseName,
      status: "ONLINE",
      uptimeSeconds: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      iops: 0,
      activeConnections: 0,
      maxConnections: 100,
      queryLatencyMs: 0,
      slowQueryCount: 0,
      diskFreeGb: 100,
      diskTotalGb: 500,
      replicationLagSeconds: 0,
      bufferHitRatio: 99,
      deadlocksCount: 0,
      lastHealthCheck: "Just now",
      engineSpecific: {},
    };

    const updated: DBInstance = {
      ...existing,
      ...delta,
      status: existing.status === "CRITICAL" ? "ONLINE" : existing.status,
      lastHealthCheck: "Just now",
    };

    this.latestInstances.set(endpoint.id, updated);

    // Dynamic Adaptive Throttling update
    const connPct =
      updated.maxConnections > 0
        ? (updated.activeConnections / updated.maxConnections) * 100
        : 0;
    this.scheduler.updateLoadMetrics(endpoint.id, updated.cpuUsage, connPct);

    // Push to Ring Buffer if L2 or L1 telemetry
    if (tier === "L2" || tier === "L1") {
      const buffer = this.ringBuffers.get(endpoint.id);
      if (buffer) {
        buffer.push({
          instanceId: endpoint.id,
          timestamp: new Date().toISOString(),
          cpu: updated.cpuUsage,
          memory: updated.memoryUsage,
          iops: updated.iops,
          activeConnections: updated.activeConnections,
          maxConnections: updated.maxConnections,
          queryLatencyMs: updated.queryLatencyMs,
          slowQueryCount: updated.slowQueryCount,
          replicationLagSeconds: updated.replicationLagSeconds,
          bufferHitRatio: updated.bufferHitRatio,
          deadlocksCount: updated.deadlocksCount,
          diskFreeGb: updated.diskFreeGb,
          diskTotalGb: updated.diskTotalGb,
          engineSpecific: updated.engineSpecific,
        });
      }
    }

    // Emit event
    const deltaEvent: TelemetryDeltaEvent = {
      instanceId: endpoint.id,
      timestamp: new Date().toISOString(),
      tier,
      metrics: delta,
    };
    this.emit("telemetry_delta", deltaEvent);

    if (tier === "L1") {
      const hbEvent: HeartbeatEvent = {
        endpointId: endpoint.id,
        timestamp: new Date().toISOString(),
        uptimeSeconds: updated.uptimeSeconds,
        latencyMs: updated.queryLatencyMs,
        status: updated.status === "CRITICAL" ? "UNREACHABLE" : "ONLINE",
      };
      this.emit("heartbeat", hbEvent);
    }
  }

  private handlePollFailure(
    endpoint: PollingEndpoint,
    breaker: EndpointCircuitBreaker,
    err: any
  ): void {
    const currState = breaker.getState();
    const evt: CircuitStateEvent = {
      endpointId: endpoint.id,
      state: currState,
      consecutiveFailures: breaker.status.consecutiveFailures,
      nextAttemptTimestamp: breaker.status.nextAttemptTimestamp,
      reason: err?.message || "Polling execution failed",
    };
    this.emit("circuit_state", evt);

    if (breaker.status.consecutiveFailures >= 2 || currState === CircuitState.OPEN) {
      const existing = this.latestInstances.get(endpoint.id);
      if (existing) {
        existing.status = "CRITICAL";
      }

      if (currState === CircuitState.OPEN) {
        const incident: IncidentAlert = {
          id: `inc-cb-${endpoint.id}-${Date.now()}`,
          ruleId: "CIRCUIT_BREAKER_TRIPPED",
          databaseId: endpoint.id,
          databaseName: endpoint.name,
          engine: endpoint.engine,
          title: `Circuit Breaker Tripped [OPEN] for ${endpoint.name}`,
          severity: "CRITICAL",
          status: "FIRING",
          currentValue: breaker.status.consecutiveFailures,
          thresholdValue: 3,
          unit: "failures",
          firedAt: new Date().toISOString(),
          notes: `Circuit tripped to OPEN state after ${breaker.status.consecutiveFailures} consecutive failures: ${err?.message}`,
        };
        this.emit("incident_fired", incident);
      }
    }
  }

  private generateSyntheticMetrics(endpoint: PollingEndpoint, tier: CadenceTier): Partial<DBInstance> {
    const cpu = Number((20 + Math.random() * 50).toFixed(1));
    const mem = Number((40 + Math.random() * 40).toFixed(1));
    const latency = Number((5 + Math.random() * 20).toFixed(1));

    if (tier === "L1") {
      return { uptimeSeconds: Math.floor(Date.now() / 1000), queryLatencyMs: latency };
    }
    return {
      cpuUsage: cpu,
      memoryUsage: mem,
      iops: Math.floor(500 + Math.random() * 1500),
      activeConnections: Math.floor(20 + Math.random() * 80),
      queryLatencyMs: latency,
    };
  }
}
