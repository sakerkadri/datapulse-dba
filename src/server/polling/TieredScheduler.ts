import { CadenceConfig, CadenceTier, PollingEndpoint } from "../../types/polling";

export interface ScheduledEndpointState {
  endpoint: PollingEndpoint;
  cadenceConfig: CadenceConfig;
  lastPoll: Record<CadenceTier, number>;
  inFlight: Record<CadenceTier, boolean>;
  isThrottled: boolean;
  recoveryTickCount: number;
  phaseOffsetMs: { L1: number; L2: number; L3: number };
}

export type PollDispatchHandler = (
  endpoint: PollingEndpoint,
  tier: CadenceTier
) => Promise<void>;

export class TieredScheduler {
  private endpoints: Map<string, ScheduledEndpointState> = new Map();
  private tickTimer: NodeJS.Timeout | null = null;
  private status: "INIT" | "RUNNING" | "PAUSED" | "STOPPED" = "INIT";
  private defaultCadence: CadenceConfig = {
    l1IntervalMs: 5000,
    l2IntervalMs: 30000,
    l3IntervalMs: 300000,
    adaptiveThrottlingEnabled: true,
    adaptiveCpuThresholdPct: 90,
    adaptiveConnThresholdPct: 90,
    adaptiveL3Multiplier: 2.0,
  };

  constructor(
    private readonly dispatchHandler: PollDispatchHandler,
    private readonly tickIntervalMs: number = 1000
  ) {}

  registerEndpoint(endpoint: PollingEndpoint): void {
    const config: CadenceConfig = {
      ...this.defaultCadence,
      ...(endpoint.cadenceConfig || {}),
    };

    const index = this.endpoints.size;
    const phaseOffsetMs = {
      L1: (index * 250) % config.l1IntervalMs,
      L2: (index * 1000) % config.l2IntervalMs,
      L3: (index * 5000) % config.l3IntervalMs,
    };

    const now = Date.now();
    this.endpoints.set(endpoint.id, {
      endpoint,
      cadenceConfig: config,
      lastPoll: {
        L1: now - config.l1IntervalMs + phaseOffsetMs.L1,
        L2: now - config.l2IntervalMs + phaseOffsetMs.L2,
        L3: now - config.l3IntervalMs + phaseOffsetMs.L3,
      },
      inFlight: { L1: false, L2: false, L3: false },
      isThrottled: false,
      recoveryTickCount: 0,
      phaseOffsetMs,
    });
  }

  unregisterEndpoint(endpointId: string): boolean {
    return this.endpoints.delete(endpointId);
  }

  getEndpointState(endpointId: string): ScheduledEndpointState | undefined {
    return this.endpoints.get(endpointId);
  }

  get registeredEndpointsCount(): number {
    return this.endpoints.size;
  }

  start(): void {
    if (this.status === "RUNNING") return;
    this.status = "RUNNING";
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }
    this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  pause(): void {
    if (this.status === "RUNNING") {
      this.status = "PAUSED";
    }
  }

  resume(): void {
    if (this.status === "PAUSED") {
      this.status = "RUNNING";
    }
  }

  stop(): void {
    this.status = "STOPPED";
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  getStatus(): "INIT" | "RUNNING" | "PAUSED" | "STOPPED" {
    return this.status;
  }

  async onDemandPoll(endpointId: string, tier: CadenceTier = "L2"): Promise<void> {
    const state = this.endpoints.get(endpointId);
    if (!state) {
      throw new Error(`Endpoint ${endpointId} is not registered`);
    }
    state.lastPoll[tier] = Date.now();
    await this.dispatchHandler(state.endpoint, tier);
  }

  updateLoadMetrics(endpointId: string, cpuUsage: number, connectionUsagePct: number): void {
    const state = this.endpoints.get(endpointId);
    if (!state || !state.cadenceConfig.adaptiveThrottlingEnabled) return;

    const isOverloaded =
      cpuUsage >= state.cadenceConfig.adaptiveCpuThresholdPct ||
      connectionUsagePct >= state.cadenceConfig.adaptiveConnThresholdPct;

    if (isOverloaded) {
      state.isThrottled = true;
      state.recoveryTickCount = 0;
    } else if (state.isThrottled) {
      state.recoveryTickCount++;
      if (state.recoveryTickCount >= 2) {
        state.isThrottled = false;
        state.recoveryTickCount = 0;
      }
    }
  }

  tick(): void {
    if (this.status !== "RUNNING") return;
    const now = Date.now();

    for (const [, state] of this.endpoints.entries()) {
      if (!state.endpoint.enabled) continue;

      const effectiveL3Interval = state.isThrottled
        ? state.cadenceConfig.l3IntervalMs * state.cadenceConfig.adaptiveL3Multiplier
        : state.cadenceConfig.l3IntervalMs;

      // Check L1
      if (!state.inFlight.L1 && now - state.lastPoll.L1 >= state.cadenceConfig.l1IntervalMs) {
        this.dispatch(state, "L1", now);
      }

      // Check L2
      if (!state.inFlight.L2 && now - state.lastPoll.L2 >= state.cadenceConfig.l2IntervalMs) {
        this.dispatch(state, "L2", now);
      }

      // Check L3
      if (!state.inFlight.L3 && now - state.lastPoll.L3 >= effectiveL3Interval) {
        this.dispatch(state, "L3", now);
      }
    }
  }

  private async dispatch(state: ScheduledEndpointState, tier: CadenceTier, now: number): Promise<void> {
    state.inFlight[tier] = true;
    state.lastPoll[tier] = now;
    try {
      await this.dispatchHandler(state.endpoint, tier);
    } catch (err) {
      console.error(`[TieredScheduler] Dispatch error for ${state.endpoint.id} (${tier}):`, err);
    } finally {
      state.inFlight[tier] = false;
    }
  }
}
