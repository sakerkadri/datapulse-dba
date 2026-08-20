import { CircuitBreakerConfig, CircuitBreakerStatus, CircuitState } from "../../types/polling";

export class EndpointCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private consecutiveTrips = 0;
  private nextAttemptTimestamp = 0;
  private halfOpenProbeInFlight = false;
  private lastFailureReason?: string;
  private lastStateChangeTimestamp = Date.now();
  private totalTrips = 0;
  private totalSuccesses = 0;

  private readonly failureThreshold: number;
  private readonly baseResetTimeoutMs: number;
  private readonly maxResetTimeoutMs: number;
  private readonly jitterFactor: number;
  private readonly executionTimeoutMs: number;

  constructor(
    public readonly endpointId: string,
    config: CircuitBreakerConfig = {}
  ) {
    this.failureThreshold = config.failureThreshold ?? 3;
    this.baseResetTimeoutMs = config.baseResetTimeoutMs ?? 10000;
    this.maxResetTimeoutMs = config.maxResetTimeoutMs ?? 300000;
    this.jitterFactor = config.jitterFactor ?? 0.25;
    this.executionTimeoutMs = config.executionTimeoutMs ?? 5000;
  }

  getState(): CircuitState {
    if (this.state === CircuitState.OPEN && Date.now() >= this.nextAttemptTimestamp) {
      this.transitionTo(CircuitState.HALF_OPEN);
      this.halfOpenProbeInFlight = false;
    }
    return this.state;
  }

  async execute<T>(action: () => Promise<T>, fallback?: (reason: string) => T): Promise<T> {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      const waitRemaining = Math.max(0, this.nextAttemptTimestamp - Date.now());
      const msg = `Circuit is OPEN for [${this.endpointId}]. Fast-failing (<1ms). Next probe in ${Math.ceil(
        waitRemaining / 1000
      )}s. Reason: ${this.lastFailureReason || "Threshold reached"}`;
      if (fallback) return fallback(msg);
      throw new Error(msg);
    }

    if (currentState === CircuitState.HALF_OPEN) {
      if (this.halfOpenProbeInFlight) {
        const msg = `Circuit is HALF_OPEN for [${this.endpointId}]. Recovery probe already in flight.`;
        if (fallback) return fallback(msg);
        throw new Error(msg);
      }
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await this.withTimeout(action(), this.executionTimeoutMs);
      this.onSuccess();
      return result;
    } catch (err: any) {
      const reason = err?.message || "Unknown error";
      this.onFailure(reason);
      if (fallback) return fallback(`Execution failed: ${reason}`);
      throw err;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveTrips = 0;
    this.halfOpenProbeInFlight = false;
    this.totalSuccesses++;
    if (this.state !== CircuitState.CLOSED) {
      this.transitionTo(CircuitState.CLOSED);
    }
  }

  private onFailure(reason: string): void {
    this.consecutiveFailures++;
    this.lastFailureReason = reason;
    this.halfOpenProbeInFlight = false;

    if (this.state === CircuitState.HALF_OPEN || this.consecutiveFailures >= this.failureThreshold) {
      this.trip(reason);
    }
  }

  private trip(reason: string): void {
    this.transitionTo(CircuitState.OPEN);
    this.consecutiveTrips++;
    this.totalTrips++;

    const rawBackoff = Math.min(
      this.maxResetTimeoutMs,
      this.baseResetTimeoutMs * Math.pow(2, this.consecutiveTrips - 1)
    );
    // Jitter: uniform distribution in [1 - jitter, 1 + jitter]
    const jitterMultiplier = 1 - this.jitterFactor + 2 * this.jitterFactor * Math.random();
    const cooldownWithJitter = Math.round(rawBackoff * jitterMultiplier);

    this.nextAttemptTimestamp = Date.now() + cooldownWithJitter;
  }

  private transitionTo(newState: CircuitState): void {
    this.state = newState;
    this.lastStateChangeTimestamp = Date.now();
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms for endpoint [${this.endpointId}]`));
      }, timeoutMs);

      promise
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  get status(): CircuitBreakerStatus {
    const currentState = this.getState();
    return {
      endpointId: this.endpointId,
      state: currentState,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveTrips: this.consecutiveTrips,
      nextAttemptTimestamp: this.nextAttemptTimestamp,
      cooldownRemainingMs: Math.max(0, this.nextAttemptTimestamp - Date.now()),
      halfOpenProbeInFlight: this.halfOpenProbeInFlight,
      lastFailureReason: this.lastFailureReason,
      lastStateChangeTimestamp: this.lastStateChangeTimestamp,
      totalTrips: this.totalTrips,
      totalSuccesses: this.totalSuccesses,
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveTrips = 0;
    this.nextAttemptTimestamp = 0;
    this.halfOpenProbeInFlight = false;
    this.lastStateChangeTimestamp = Date.now();
    this.lastFailureReason = undefined;
  }
}
