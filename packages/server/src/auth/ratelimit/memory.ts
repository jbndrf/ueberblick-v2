import type { RateLimiter } from './port';

export interface MemoryRateLimiterOptions {
  /** The only clock: injected so tests can move time. */
  readonly now: () => Date;
  /** Failures inside `windowMs` after which the key is refused. */
  readonly maxFailures: number;
  readonly windowMs: number;
  /** Upper bound on tracked keys (memory guard against key flooding). Default 10 000. */
  readonly maxKeys?: number;
}

/** In-process limiter: a sliding window of failure times per key. */
export function createMemoryRateLimiter(opts: MemoryRateLimiterOptions): RateLimiter & { size(): number } {
  const maxKeys = opts.maxKeys ?? 10_000;
  const failures = new Map<string, number[]>();

  const live = (key: string, now: number): number[] => {
    const all = failures.get(key);
    if (!all) return [];
    const kept = all.filter((t) => t > now - opts.windowMs);
    if (kept.length === 0) failures.delete(key);
    else if (kept.length !== all.length) failures.set(key, kept);
    return kept;
  };

  return {
    check(key) {
      const now = opts.now().getTime();
      const f = live(key, now);
      if (f.length < opts.maxFailures) return { ok: true };
      const oldest = f[f.length - opts.maxFailures] ?? now;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + opts.windowMs - now) / 1000)) };
    },
    fail(key) {
      const now = opts.now().getTime();
      const f = live(key, now);
      f.push(now);
      failures.delete(key); // re-insert: Map order = least recently failed first
      failures.set(key, f.slice(-opts.maxFailures));
      while (failures.size > maxKeys) {
        const first = failures.keys().next();
        if (first.done) break;
        failures.delete(first.value);
      }
    },
    reset(key) {
      failures.delete(key);
    },
    size: () => failures.size,
  };
}
