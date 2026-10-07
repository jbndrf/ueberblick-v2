/**
 * The one limiter per upstream host (A-033): at most `concurrency` requests in flight and at most `perSecond` started
 * per second. The tile proxy and the pack builder both fetch through the same instance, so a bulk pack fetch and live
 * map traffic share one politeness budget. `penalize` pushes the next start back (an upstream's `Retry-After`).
 */
export interface HostLimiterOptions {
  readonly concurrency: number;
  readonly perSecond: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface HostLimiter {
  /** Runs `fn` once a slot of `host` is free and the host's rate allows it. */
  run<T>(host: string, fn: () => Promise<T>): Promise<T>;
  /** No request to `host` starts in the next `ms` milliseconds. */
  penalize(host: string, ms: number): void;
}

interface HostState {
  active: number;
  nextStart: number;
  readonly waiting: (() => void)[];
}

export function createHostLimiter(opts: HostLimiterOptions): HostLimiter {
  const limit = Math.max(1, Math.floor(opts.concurrency));
  const interval = 1000 / Math.max(0.001, opts.perSecond);
  const hosts = new Map<string, HostState>();
  const stateOf = (host: string): HostState => {
    let s = hosts.get(host);
    if (s === undefined) hosts.set(host, (s = { active: 0, nextStart: 0, waiting: [] }));
    return s;
  };
  return {
    penalize(host, ms) {
      const s = stateOf(host);
      s.nextStart = Math.max(s.nextStart, opts.now() + ms);
    },
    async run(host, fn) {
      const s = stateOf(host);
      if (s.active >= limit) await new Promise<void>((r) => s.waiting.push(r));
      else s.active++;
      // A waiter inherits the slot of the request that finished (see `finally`), so `active` is already counted.
      try {
        const start = Math.max(opts.now(), s.nextStart);
        s.nextStart = start + interval;
        const wait = start - opts.now();
        if (wait > 0) await opts.sleep(wait);
        return await fn();
      } finally {
        const next = s.waiting.shift();
        if (next === undefined) s.active--;
        else next();
      }
    },
  };
}
