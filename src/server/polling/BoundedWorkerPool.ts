import { QueuedTask, WorkerPoolStats } from "../../types/polling";

export class BoundedWorkerPool {
  private activeWorkers = 0;
  private buckets: Record<number, QueuedTask<any>[]> = { 3: [], 2: [], 1: [] };
  private sequenceCounter = 0;
  private totalExecuted = 0;
  private totalFailed = 0;
  private totalEvicted = 0;
  private totalRejected = 0;
  private executionTimes: number[] = [];

  constructor(
    public readonly zone: string,
    public readonly maxConcurrency: number = 10,
    public readonly maxQueueSize: number = 500
  ) {
    if (maxConcurrency <= 0) {
      throw new Error(`[WorkerPool:${zone}] maxConcurrency must be > 0`);
    }
    if (maxQueueSize <= 0) {
      throw new Error(`[WorkerPool:${zone}] maxQueueSize must be > 0`);
    }
  }

  async run<T>(endpointId: string, task: () => Promise<T>, priority: number = 2): Promise<T> {
    const validPriority = Math.min(3, Math.max(1, Math.floor(priority)));
    const totalQueued = this.queuedTasks;

    // Check if queue is full and we need to evict or reject
    if (this.activeWorkers >= this.maxConcurrency && totalQueued >= this.maxQueueSize) {
      // Priority-aware eviction: check if there is a lower-priority task in the queue
      let evicted = false;
      for (let lowerPrio = 1; lowerPrio < validPriority; lowerPrio++) {
        if (this.buckets[lowerPrio].length > 0) {
          const evictedTask = this.buckets[lowerPrio].shift()!;
          this.totalEvicted++;
          evictedTask.reject(
            new Error(
              `[WorkerPool:${this.zone}] Task for ${evictedTask.endpointId} evicted in favor of higher priority task (Prio ${validPriority})`
            )
          );
          evicted = true;
          break;
        }
      }

      if (!evicted) {
        this.totalRejected++;
        throw new Error(
          `[WorkerPool:${this.zone}] Queue overflow (${totalQueued} tasks). Dropping task for ${endpointId}`
        );
      }
    }

    return new Promise<T>((resolve, reject) => {
      const queuedItem: QueuedTask<T> = {
        id: `task_${Date.now()}_${++this.sequenceCounter}`,
        priority: validPriority,
        endpointId,
        execute: task,
        resolve,
        reject,
        createdAt: Date.now(),
        sequenceId: this.sequenceCounter,
      };

      if (this.activeWorkers < this.maxConcurrency) {
        this.dispatch(queuedItem);
      } else {
        this.buckets[validPriority].push(queuedItem);
      }
    });
  }

  private async dispatch(item: QueuedTask<any>) {
    this.activeWorkers++;
    const start = Date.now();
    try {
      const result = await item.execute();
      this.totalExecuted++;
      this.recordDuration(Date.now() - start);
      item.resolve(result);
    } catch (err) {
      this.totalFailed++;
      this.recordDuration(Date.now() - start);
      item.reject(err);
    } finally {
      this.activeWorkers--;
      this.drainNext();
    }
  }

  private drainNext() {
    if (this.activeWorkers < this.maxConcurrency) {
      const nextTask =
        this.buckets[3].shift() ||
        this.buckets[2].shift() ||
        this.buckets[1].shift();

      if (nextTask) {
        this.dispatch(nextTask);
      }
    }
  }

  get queuedTasks(): number {
    return this.buckets[3].length + this.buckets[2].length + this.buckets[1].length;
  }

  get currentActiveWorkers(): number {
    return this.activeWorkers;
  }

  get stats(): WorkerPoolStats {
    const avg =
      this.executionTimes.length > 0
        ? Math.round(this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length)
        : 0;

    return {
      zone: this.zone,
      activeWorkers: this.activeWorkers,
      queuedTasks: this.queuedTasks,
      queuedL1: this.buckets[3].length,
      queuedL2: this.buckets[2].length,
      queuedL3: this.buckets[1].length,
      maxConcurrency: this.maxConcurrency,
      maxQueueSize: this.maxQueueSize,
      totalExecuted: this.totalExecuted,
      totalFailed: this.totalFailed,
      totalEvicted: this.totalEvicted,
      totalRejected: this.totalRejected,
      avgExecutionTimeMs: avg,
    };
  }

  private recordDuration(ms: number) {
    this.executionTimes.push(ms);
    if (this.executionTimes.length > 100) {
      this.executionTimes.shift();
    }
  }

  clearQueue(): void {
    for (const p of [3, 2, 1]) {
      while (this.buckets[p].length > 0) {
        const t = this.buckets[p].shift()!;
        t.reject(new Error(`[WorkerPool:${this.zone}] Queue cleared`));
      }
    }
  }
}
