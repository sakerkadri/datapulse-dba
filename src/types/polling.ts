import type { DatabaseEngine, DBInstance, IncidentAlert } from "./dba";
export type { IncidentAlert };


export type CadenceTier = "L1" | "L2" | "L3";

export enum TaskPriority {
  L3_DIAGNOSTICS = 1,
  L2_TELEMETRY = 2,
  L1_HEARTBEAT = 3,
}

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;     // Default: 3
  baseResetTimeoutMs?: number;   // Default: 10,000ms
  maxResetTimeoutMs?: number;    // Default: 300,000ms (5 min)
  jitterFactor?: number;         // Default: 0.25 (±25%)
  executionTimeoutMs?: number;   // Default: 5,000ms
}

export interface CircuitBreakerStatus {
  endpointId: string;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveTrips: number;
  nextAttemptTimestamp: number;
  cooldownRemainingMs: number;
  halfOpenProbeInFlight: boolean;
  lastFailureReason?: string;
  lastStateChangeTimestamp: number;
  totalTrips: number;
  totalSuccesses: number;
}

export interface CadenceConfig {
  l1IntervalMs: number;
  l2IntervalMs: number;
  l3IntervalMs: number;
  adaptiveThrottlingEnabled: boolean;
  adaptiveCpuThresholdPct: number;
  adaptiveConnThresholdPct: number;
  adaptiveL3Multiplier: number;
}

export interface PollingEndpoint {
  id: string;
  name: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  databaseName: string;
  zone: string;
  enabled: boolean;
  credentials?: {
    username?: string;
    password?: string;
    authType?: "password" | "key" | "sso";
  };
  cadenceConfig?: Partial<CadenceConfig>;
}

export interface QueuedTask<T = any> {
  id: string;
  priority: number; // 3 = L1, 2 = L2, 1 = L3
  endpointId: string;
  tier?: CadenceTier;
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  createdAt: number;
  sequenceId: number;
}

export interface WorkerPoolConfig {
  zone: string;
  maxConcurrency?: number; // Default: 10
  maxQueueSize?: number;   // Default: 500
}

export interface WorkerPoolStats {
  zone: string;
  activeWorkers: number;
  queuedTasks: number;
  queuedL1: number;
  queuedL2: number;
  queuedL3: number;
  maxConcurrency: number;
  maxQueueSize: number;
  totalExecuted: number;
  totalFailed: number;
  totalEvicted: number;
  totalRejected: number;
  avgExecutionTimeMs: number;
}

export interface TelemetrySample {
  instanceId: string;
  timestamp: string;
  cpu: number;
  memory: number;
  iops: number;
  activeConnections: number;
  maxConnections: number;
  queryLatencyMs: number;
  slowQueryCount: number;
  replicationLagSeconds: number;
  bufferHitRatio: number;
  deadlocksCount: number;
  diskFreeGb: number;
  diskTotalGb: number;
  engineSpecific?: Record<string, any>;
}

export interface RollingStats {
  min: number;
  max: number;
  avg: number;
  latest: number;
  p95: number;
  count: number;
}

export interface RollingMetricsSummary {
  instanceId: string;
  sampleCount: number;
  timeWindowSeconds: number;
  cpu: RollingStats;
  memory: RollingStats;
  iops: RollingStats;
  latencyMs: RollingStats;
  activeConnections: RollingStats;
  bufferHitRatio: RollingStats;
}

export interface ITelemetryRingBuffer<T> {
  readonly capacity: number;
  readonly size: number;
  readonly latest: T | null;
  push(item: T): void;
  toArray(): T[];
  getRange(sinceTimestampMs: number): T[];
  clear(): void;
  getRollingStats(extractor: (sample: T) => number): RollingStats;
  getMetricSummary(): RollingMetricsSummary;
}

export interface IEndpointCollector {
  collectL1(endpoint: PollingEndpoint): Promise<Partial<DBInstance>>;
  collectL2(endpoint: PollingEndpoint): Promise<Partial<DBInstance>>;
  collectL3(endpoint: PollingEndpoint): Promise<Partial<DBInstance>>;
}

export interface TelemetryDeltaEvent {
  instanceId: string;
  timestamp: string;
  tier: CadenceTier;
  metrics: Partial<DBInstance>;
  hostMetrics?: any;
}

export interface CircuitStateEvent {
  endpointId: string;
  state: CircuitState;
  consecutiveFailures: number;
  nextAttemptTimestamp: number;
  reason?: string;
}

export interface HeartbeatEvent {
  endpointId: string;
  timestamp: string;
  uptimeSeconds: number;
  latencyMs: number;
  status: "ONLINE" | "UNREACHABLE" | "DEGRADED";
}

export interface StreamSnapshotPayload {
  instances: DBInstance[];
  timestamp: string;
}

export interface StreamTelemetryDeltaPayload extends TelemetryDeltaEvent {}

export interface StreamCircuitStatePayload extends CircuitStateEvent {}

export interface EngineStats {
  status: "INIT" | "RUNNING" | "PAUSED" | "STOPPED";
  totalEndpoints: number;
  activeEndpoints: number;
  totalPollsExecuted: number;
  totalPollErrors: number;
  pollsPerSecond: number;
  uptimeSeconds: number;
  zones: WorkerPoolStats[];
  circuitBreakers: {
    closed: number;
    open: number;
    halfOpen: number;
    trippedEndpoints: string[];
  };
  ringBufferMemoryBytes: number;
}
