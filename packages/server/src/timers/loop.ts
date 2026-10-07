/**
 * The timers loop (WP-137): what makes `Timers.tick` happen. At start, and on the first sight of a project, its
 * `schedule` rows are created (`syncSchedules`); then `tick(now)` runs for every project, at once and every
 * `intervalMs`. `stop()` clears the beat, so a shutdown leaves nothing running. The beat is a port (`every`), so
 * tests drive it by hand with a fake clock.
 *
 * One project failing (its database is gone, a tick throws) is reported to `onError` and never stops the others.
 * A deploy calls `rebuild` on its own (`ProjectServices.afterDeploy`), not this loop.
 */
import type { Clock } from '@ueberblick/core';
import type { TickResult, Timers } from './contract';

export interface TimersLoopDeps {
  readonly clock: Clock;
  /** The keys of the projects to tick; read on every beat, so a project created later is picked up. */
  projects(): readonly string[];
  /** The served keys of the live previews (A-031), ticked like projects. A second list: `projects` never contains one. */
  previews?(): readonly string[];
  timers(projectKey: string): Pick<Timers, 'syncSchedules' | 'tick'>;
  /** Runs after a project's tick on every beat: the guest expiry of that project (WP-639). */
  guests?(projectKey: string): void;
  readonly intervalMs: number;
  /** Calls `fn` every `ms` until the returned function is called. Default: an unref-ed `setInterval`. */
  readonly every?: (fn: () => void, ms: number) => () => void;
  readonly onError?: (projectKey: string, error: unknown) => void;
}

export interface TimersLoop {
  /** One pass over every project now (the beat does the same). A stopped loop does nothing. */
  runOnce(): TickResult;
  stop(): void;
}

const defaultEvery = (fn: () => void, ms: number): (() => void) => {
  const timer = setInterval(fn, ms);
  timer.unref();
  return () => clearInterval(timer);
};

export function startTimersLoop(deps: TimersLoopDeps): TimersLoop {
  const synced = new Set<string>();
  let stopped = false;

  const runOnce = (): TickResult => {
    const sum = { fired: 0, refused: 0, skipped: 0, failed: 0 };
    if (stopped) return sum;
    const now = deps.clock.now();
    for (const key of [...deps.projects(), ...(deps.previews?.() ?? [])]) {
      try {
        const timers = deps.timers(key);
        if (!synced.has(key)) {
          timers.syncSchedules();
          synced.add(key);
        }
        const r = timers.tick(now);
        sum.fired += r.fired;
        sum.refused += r.refused;
        sum.skipped += r.skipped;
        sum.failed += r.failed;
        deps.guests?.(key);
      } catch (e) {
        deps.onError?.(key, e);
      }
    }
    return sum;
  };

  runOnce();
  const cancel = (deps.every ?? defaultEvery)(runOnce, deps.intervalMs);
  return {
    runOnce,
    stop() {
      if (stopped) return;
      stopped = true;
      cancel();
    },
  };
}
