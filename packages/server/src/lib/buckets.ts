interface QueueEntry {
  domain: string;
  run: () => void;
}

interface BucketState {
  active: number;
  nextAllowedAt: number;
}

export interface BucketLimits {
  concurrency: number;
  delayMs: number;
}

export interface SchedulerOptions {
  globalConcurrency: number;
  defaultLimits: BucketLimits;
  /** Platform hosts need their own limits — every social fetch collapses into one bucket. */
  overrides?: Record<string, BucketLimits>;
}

/**
 * Sequential-ish politeness scheduler. The per-domain guarantee is the real
 * politeness mechanism; the global cap is only a backstop.
 *
 * Deliberately hand-rolled rather than p-limit/p-queue: neither models
 * per-key serialization + minimum delay + per-key overrides together.
 */
export class DomainScheduler {
  private readonly queue: QueueEntry[] = [];
  private readonly buckets = new Map<string, BucketState>();
  private activeGlobal = 0;
  private timer: NodeJS.Timeout | null = null;
  private paused = false;

  constructor(private readonly opts: SchedulerOptions) {}

  get pending(): number {
    return this.queue.length;
  }

  get inFlight(): number {
    return this.activeGlobal;
  }

  private limitsFor(domain: string): BucketLimits {
    return this.opts.overrides?.[domain] ?? this.opts.defaultLimits;
  }

  private bucket(domain: string): BucketState {
    let b = this.buckets.get(domain);
    if (!b) {
      b = { active: 0, nextAllowedAt: 0 };
      this.buckets.set(domain, b);
    }
    return b;
  }

  /** Pause everything (used while a hard rate limit is being backed off). */
  pause(ms: number): void {
    this.paused = true;
    setTimeout(() => {
      this.paused = false;
      // System sleep can leave stale future timestamps; never let them wedge the queue.
      const now = Date.now();
      for (const b of this.buckets.values()) if (b.nextAllowedAt > now + 60_000) b.nextAllowedAt = now;
      this.pump();
    }, ms).unref?.();
  }

  run<T>(domain: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        domain,
        run: () => {
          const limits = this.limitsFor(domain);
          const b = this.bucket(domain);
          b.active++;
          b.nextAllowedAt = Date.now() + limits.delayMs;
          this.activeGlobal++;
          fn()
            .then(resolve, reject)
            .finally(() => {
              b.active--;
              this.activeGlobal--;
              this.pump();
            });
        },
      });
      this.pump();
    });
  }

  private pump(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.paused) return;

    let earliestWait = Number.POSITIVE_INFINITY;

    while (this.activeGlobal < this.opts.globalConcurrency) {
      const now = Date.now();
      let startedIndex = -1;

      for (let i = 0; i < this.queue.length; i++) {
        const entry = this.queue[i]!;
        const limits = this.limitsFor(entry.domain);
        const b = this.bucket(entry.domain);
        if (b.active >= limits.concurrency) continue;
        if (b.nextAllowedAt > now) {
          earliestWait = Math.min(earliestWait, b.nextAllowedAt - now);
          continue;
        }
        startedIndex = i;
        break;
      }

      if (startedIndex === -1) break;
      const [entry] = this.queue.splice(startedIndex, 1);
      entry!.run();
    }

    if (Number.isFinite(earliestWait) && (this.queue.length > 0 || this.activeGlobal > 0)) {
      const wait = Math.max(15, Math.min(earliestWait, 5000));
      this.timer = setTimeout(() => this.pump(), wait);
      this.timer.unref?.();
    }
  }
}
