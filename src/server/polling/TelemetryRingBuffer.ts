import {
  ITelemetryRingBuffer,
  RollingMetricsSummary,
  RollingStats,
  TelemetrySample,
} from "../../types/polling";

export class TelemetryRingBuffer<T = any>
  implements ITelemetryRingBuffer<T>
{
  private buffer: (T | null)[];
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(public readonly capacity: number = 60) {
    if (capacity <= 0) {
      throw new Error("RingBuffer capacity must be > 0");
    }
    this.buffer = new Array(capacity).fill(null);
  }

  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity; // Evict oldest
    }
  }

  toArray(): T[] {
    const result: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      result[i] = this.buffer[idx]!;
    }
    return result;
  }

  getRange(sinceTimestampMs: number): T[] {
    return this.toArray().filter((item) => {
      const ts = (item as any)?.timestamp;
      if (!ts) return true;
      const t = new Date(ts).getTime();
      return t >= sinceTimestampMs;
    });
  }

  get latest(): T | null {
    if (this.count === 0) return null;
    const lastIdx = (this.tail - 1 + this.capacity) % this.capacity;
    return this.buffer[lastIdx];
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  getRollingStats(extractor: (sample: T) => number): RollingStats {
    if (this.count === 0) {
      return { min: 0, max: 0, avg: 0, latest: 0, p95: 0, count: 0 };
    }

    const values: number[] = [];
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const val = extractor(this.buffer[idx]!);
      if (typeof val === "number" && !isNaN(val)) {
        values.push(val);
        sum += val;
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }

    if (values.length === 0) {
      return { min: 0, max: 0, avg: 0, latest: 0, p95: 0, count: 0 };
    }

    const latest = values[values.length - 1];
    const avg = Number((sum / values.length).toFixed(2));
    const sorted = [...values].sort((a, b) => a - b);
    const p95Idx = Math.floor(sorted.length * 0.95);
    const p95 = sorted[Math.min(sorted.length - 1, p95Idx)];

    return {
      min: Number(min.toFixed(2)),
      max: Number(max.toFixed(2)),
      avg,
      latest: Number(latest.toFixed(2)),
      p95: Number(p95.toFixed(2)),
      count: values.length,
    };
  }

  getMetricSummary(): RollingMetricsSummary {
    const rawLatest = this.latest as unknown as TelemetrySample;
    const instanceId = rawLatest?.instanceId || "unknown";

    const typedExtractor = (key: keyof TelemetrySample) => (sample: T) => {
      const val = (sample as any)[key];
      return typeof val === "number" ? val : 0;
    };

    return {
      instanceId,
      sampleCount: this.count,
      timeWindowSeconds: this.count * 30,
      cpu: this.getRollingStats(typedExtractor("cpu")),
      memory: this.getRollingStats(typedExtractor("memory")),
      iops: this.getRollingStats(typedExtractor("iops")),
      latencyMs: this.getRollingStats(typedExtractor("queryLatencyMs")),
      activeConnections: this.getRollingStats(typedExtractor("activeConnections")),
      bufferHitRatio: this.getRollingStats(typedExtractor("bufferHitRatio")),
    };
  }
}
