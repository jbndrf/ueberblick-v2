// In-page measurement helpers shared by the scenarios. The runner reads `window.__bench`.
export interface LongTask {
  readonly start: number;
  readonly duration: number;
}

export interface BenchState {
  /** Main-thread long tasks (over 50 ms) since page load or the last `resetLongTasks`. */
  longtasks: LongTask[];
  /** Named measurements in ms. NaN until measured. */
  metrics: Record<string, number>;
  /** The page finished setting up and waits for the runner. */
  ready: boolean;
  /** Set by scenarios that need the runner to start the measured part (map). */
  begin?: () => void;
  errors: string[];
}

declare global {
  interface Window {
    __bench: BenchState;
  }
}

export function installProbe(): BenchState {
  const state: BenchState = { longtasks: [], metrics: {}, ready: false, errors: [] };
  window.__bench = state;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) state.longtasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: 'longtask', buffered: true });
  window.addEventListener('error', (e) => state.errors.push(String(e.message)));
  return state;
}

/** Resolves (with `performance.now()`) after the next frame has been painted: rAF, then a task. */
export function afterPaint(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve(performance.now());
      ch.port2.postMessage(null);
    });
  });
}

/** Test mode: `?slow=<ms>` blocks the main thread for that long where a scenario calls this. */
export function slowdown(): void {
  const ms = Number(new URLSearchParams(location.search).get('slow') ?? 0);
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* busy wait on purpose */
  }
}

/** Interaction to next paint for an event: from the event's timestamp (includes input delay) to after paint. */
export async function inpSince(e: Event): Promise<number> {
  return (await afterPaint()) - e.timeStamp;
}
