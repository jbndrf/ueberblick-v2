// Small helpers the renderer shares between its listener sets and its pixel/position conversions.
import type { Position } from '@ueberblick/core/geo';
import type { MlMap } from './api';

export interface Listeners<A extends unknown[]> {
  /** Adds a listener; the result removes it again. */
  add(listener: (...args: A) => void): () => void;
  emit(...args: A): void;
}

export function createListeners<A extends unknown[]>(): Listeners<A> {
  const set = new Set<(...args: A) => void>();
  return {
    add(listener) {
      set.add(listener);
      return () => set.delete(listener);
    },
    emit(...args) {
      for (const l of set) l(...args);
    },
  };
}

/** Position and pixel conversion on a map that has loaded; `undefined` before. */
export function createProjection(ready: () => MlMap | undefined): {
  project(at: Position): { x: number; y: number } | undefined;
  unproject(point: { x: number; y: number }): Position | undefined;
} {
  return {
    project(at) {
      return ready()?.project([at[0], at[1]]);
    },
    unproject(point) {
      const m = ready();
      if (m === undefined) return undefined;
      const { lng, lat } = m.unproject([point.x, point.y]);
      return [lng, lat];
    },
  };
}
