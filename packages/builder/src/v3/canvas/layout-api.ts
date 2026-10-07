/**
 * Stored canvas positions (WP-366, E-21). v3 saved where the admin dragged a stage (`setStagePosition`,
 * `TaskCanvas.svelte:466-470`) and kept every other node only in memory (`posCache`, `:89, 179-194`), which
 * lost them on reload. Here every node keeps its place. The positions live next to the draft on the server,
 * never in the config, so the canvas knows no URL: the host provides this port with `setCanvasLayoutApi`
 * (Svelte context), the same way the Versions lens gets its api.
 */
import { getContext, setContext } from 'svelte';
import type { Point } from './arrange';

export interface PlacedNode extends Point {
  readonly id: string;
}

export interface CanvasLayoutApi {
  /** The stored positions of the type's canvas. */
  load(type: string): Promise<readonly PlacedNode[]>;
  /** Makes `nodes` the stored set of the type (the server prunes everything not listed). */
  save(type: string, nodes: readonly PlacedNode[]): Promise<void>;
}

/** The context key; a test mounts the canvas with `context: new Map([[CANVAS_LAYOUT_API_CONTEXT, api]])`. */
export const CANVAS_LAYOUT_API_CONTEXT = Symbol('builder.canvas.layout.api');
const KEY = CANVAS_LAYOUT_API_CONTEXT;

export const setCanvasLayoutApi = (api: CanvasLayoutApi): void => {
  setContext(KEY, api);
};

/** The api the host provided; without one the canvas still drags, but positions are not kept. */
export const getCanvasLayoutApi = (): CanvasLayoutApi | undefined =>
  getContext<CanvasLayoutApi | undefined>(KEY);

/** The automatic arrangement, with each stored position laid over its node: stored positions win. */
export function withStored(
  arranged: ReadonlyMap<string, Point>,
  stored: ReadonlyMap<string, Point>,
): ReadonlyMap<string, Point> {
  const out = new Map(arranged);
  for (const [id, at] of stored) if (out.has(id)) out.set(id, at);
  return out;
}

/** What to save: the stored positions of nodes that still exist. A removed stage's position is left out, so the server prunes it. */
export function pruned(
  stored: ReadonlyMap<string, Point>,
  existing: ReadonlySet<string>,
): readonly PlacedNode[] {
  return [...stored].filter(([id]) => existing.has(id)).map(([id, at]) => ({ id, x: at.x, y: at.y }));
}

/** Waits this long after the last drag end before saving, so quick successive drags are one request. */
export const SAVE_DELAY_MS = 400;

export interface LayoutSaver {
  /** Schedules a save of `nodes`; a later call before the delay replaces it. */
  schedule(nodes: readonly PlacedNode[]): void;
  /** Sends a pending save now (the canvas closes, or a test). */
  flush(): Promise<void>;
}

export function createLayoutSaver(
  api: CanvasLayoutApi,
  type: string,
  delay: number = SAVE_DELAY_MS,
): LayoutSaver {
  let pending: readonly PlacedNode[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = async (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const nodes = pending;
    pending = undefined;
    if (nodes === undefined) return;
    try {
      await api.save(type, nodes);
    } catch {
      // A position is an aid: a failed save is retried by the next drag, and nothing else depends on it.
    }
  };
  return {
    schedule(nodes) {
      pending = nodes;
      clearTimeout(timer);
      timer = setTimeout(() => void send(), delay);
    },
    flush: send,
  };
}
