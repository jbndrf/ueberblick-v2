/**
 * Auto-sync triggers (docs/07): a pull on open, on `online`, on `visibilitychange`, and after the doorbell.
 * The doorbell is only "something changed": a burst collapses into one pull, and the worker's single-flight
 * covers a ring that arrives during a pull. There is no Background Sync on iOS, so the lifecycle pulls matter.
 */
import { DOORBELL_DEBOUNCE_MS, type AutoSyncDeps } from './contract';
import type { SyncTrigger } from '@ueberblick/core/registry';

export interface AutoSync {
  /** Pulls now (trigger `open`) and starts listening. */
  start(): void;
  stop(): void;
}

export function createAutoSync(deps: AutoSyncDeps): AutoSync {
  const { worker, timers, doorbell, online, visible } = deps;
  const debounceMs = deps.debounceMs ?? DOORBELL_DEBOUNCE_MS;
  let stops: (() => void)[] = [];
  let timer: unknown;

  const pull = (trigger: SyncTrigger) => {
    worker.pull().catch((error: unknown) => deps.onError?.(trigger, error));
  };
  const syncTools = (trigger: SyncTrigger) => {
    deps.tools?.sync().catch((error: unknown) => deps.onError?.(trigger, error));
  };
  const toolTimers = new Map<string, unknown>();
  const ringTool = (key: string) => {
    const tools = deps.tools;
    if (!tools) return;
    const old = toolTimers.get(key);
    if (old !== undefined) timers.clear(old);
    toolTimers.set(
      key,
      timers.set(() => {
        toolTimers.delete(key);
        tools.pull(key).catch((error: unknown) => deps.onError?.('doorbell', error));
      }, debounceMs),
    );
  };
  const ring = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = timers.set(() => {
      timer = undefined;
      pull('doorbell');
    }, debounceMs);
  };

  return {
    start() {
      if (stops.length) return;
      stops = [
        doorbell.subscribe(ring),
        online.subscribe(() => {
          pull('online');
          syncTools('online');
        }),
        visible.subscribe(() => {
          pull('visible');
          syncTools('visible');
        }),
        ...(deps.tools ? [deps.tools.doorbell.subscribe(ringTool)] : []),
      ];
      pull('open');
      syncTools('open');
    },
    stop() {
      stops.forEach((s) => s());
      stops = [];
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
      for (const t of toolTimers.values()) timers.clear(t);
      toolTimers.clear();
    },
  };
}
