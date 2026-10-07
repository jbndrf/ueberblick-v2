// @vitest-environment jsdom
/**
 * Budget (WP-635, docs/12 interaction-to-next-paint, R14): drawing on the map stays smooth. A tap that adds a vertex
 * and a drag move of a vertex, on a 200-vertex area, cost one session change and one overlay re-draw: no feature is
 * re-sent and no cluster recomputed (the controller only has overlays and markers to call). The cost here is the JS
 * of the change; painting the overlay source is MapLibre's. Run: npm test -- -c bench/vitest.config.ts bench/draw-on-map
 */
import { describe, expect, it } from 'vitest';
import type { Position } from '../../packages/core/src/geo';
import { createDrawController, createSession, type MapHandle } from '../../packages/ui/src/map';
import { docBudget, report } from '../harness/budget.mjs';

const N = 200;

function fakeHandle() {
  const taps = new Set<(p: Position) => void>();
  const drags = new Set<(id: string, p: Position) => void>();
  const calls = { overlays: 0, markers: 0, other: 0 };
  const handle = new Proxy(
    {
      onMapTap: (f: (p: Position) => void) => (taps.add(f), () => taps.delete(f)),
      onMarkerDrag: (f: (id: string, p: Position) => void) => (drags.add(f), () => drags.delete(f)),
      showOverlay: () => void calls.overlays++,
      clearOverlay: () => void calls.overlays++,
      addMarker: () => void calls.markers++,
      moveMarker: () => void calls.markers++,
      removeMarker: () => void calls.markers++,
    } as unknown as Record<string, unknown>,
    {
      get(target, key: string) {
        if (!(key in target)) throw new Error(`the draw controller must not call MapHandle.${key}`);
        return target[key];
      },
    },
  ) as unknown as MapHandle;
  return {
    handle,
    calls,
    tap: (p: Position) => taps.forEach((f) => f(p)),
    drag: (id: string, p: Position) => drags.forEach((f) => f(id, p)),
  };
}

const ring = (n: number): Position[] =>
  Array.from({ length: n }, (_, i) => [
    9 + Math.cos((i / n) * 2 * Math.PI) * 0.01,
    48 + Math.sin((i / n) * 2 * Math.PI) * 0.01,
  ]);

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe('draw on the map', () => {
  it('adds and moves a vertex of a 200-vertex area without touching features', () => {
    const f = fakeHandle();
    const session = createSession('polygon', true);
    createDrawController(f.handle, session, { active: '#f00', idle: '#00f' });
    for (const p of ring(N)) f.tap(p);
    const add: number[] = [];
    const move: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      f.tap([9.02 + i * 1e-4, 48.02]);
      add.push(performance.now() - t0);
    }
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      f.drag('draw-vertex-0-5', [9.03 + i * 1e-4, 48.03]);
      move.push(performance.now() - t0);
    }
    expect(session.parts()[0]?.points).toHaveLength(N + 20);
    console.log(
      `bench draw 200 vertices: add median ${median(add).toFixed(2)} ms, move median ${median(move).toFixed(2)} ms`,
    );
    report(docBudget('interaction-to-next-paint', { device: 'x4', thread: 'main' }), median(add));
    report(docBudget('interaction-to-next-paint', { device: 'x4', thread: 'main' }), median(move));
  });
});
