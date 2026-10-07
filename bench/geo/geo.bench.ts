/**
 * Budgets (docs/12-performance-budgets.md, WP-030):
 *  - derive for 60k points <= 300 ms
 *  - distance to 2k polygon candidates <= 20 ms (WP-031)
 *  - point-in-polygon for 60k points x 2k polygons via the bbox index <= 2 s
 * Run: npm test -- -c bench/geo/vitest.config.ts   (prints a table, fails when a budget is missed)
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { createGeo } from '../../packages/core/src/geo';
import type { Point } from '../../packages/core/src/geo/contract';
import { areas, points } from './data';

const geo = createGeo();
const COLS = 50;
const ROWS = 40;
const N = 60_000;
const polys = areas(COLS, ROWS);

/** Median of `runs` timed executions, in ms. */
function time(name: string, budgetMs: number | undefined, fn: () => void, runs = 5): number {
  fn(); // warm-up: JIT and caches
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(runs / 2)] ?? 0;
  const budget = budgetMs === undefined ? '' : ` (budget ${budgetMs} ms)`;
  console.log(
    `bench ${name}: median ${median.toFixed(2)} ms, min ${(samples[0] ?? 0).toFixed(2)} ms, max ${(samples[runs - 1] ?? 0).toFixed(2)} ms${budget}`,
  );
  return median;
}

describe('geo benchmarks', () => {
  it('derive 60k points', () => {
    const probes = points(N, COLS, ROWS);
    const ms = time('derive 60k points', 300, () => probes.forEach((p) => geo.derive(p)));
    assertBudget(
      report(
        defineBudget({
          id: 'geo-derive-60k',
          limit: 300,
          unit: 'ms',
          derivedFrom:
            'run-endpoint-p95: geometry derivation of a run runs on server and device; 60k is the import case',
          device: 'x4',
          thread: 'worker',
        }),
        ms,
      ),
    );
  });

  it('derive 2k polygons of 12 vertices', () => {
    time('derive 2k polygons', undefined, () => polys.forEach(([, g]) => geo.derive(g)), 3);
  });

  it('point in polygon 60k x 2k via the bbox index', () => {
    const probes = points(N, COLS, ROWS);
    const total = time('index build 2k polygons + 60k within queries', 2000, () => {
      const idx = geo.index(polys);
      for (const p of probes) idx.query('within', p);
    });
    assertBudget(
      report(
        defineBudget({
          id: 'geo-pip-60k-2k',
          limit: 2000,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: point-in-area derivation over an import of 60k features',
          device: 'x4',
          thread: 'worker',
        }),
        total,
      ),
    );
    const idx = geo.index(polys);
    time('60k within queries (index prebuilt)', undefined, () =>
      probes.forEach((p) => idx.query('within', p)),
    );
    let hits = 0;
    for (const p of probes) hits += idx.query('within', p).length;
    expect(hits).toBeGreaterThan(N / 4); // sanity: the polygons cover a good part of the area
  });

  it('distance to 2k polygon candidates', () => {
    const probe: Point = { type: 'Point', coordinates: [13.25, 52.42] };
    const idx = geo.index(polys); // built once, like the point-in-area index; the tap only asks nearest
    const brute = time('distance to 2k polygons, brute force (reference)', undefined, () =>
      polys.forEach(([, g]) => geo.distanceM(probe, g)),
    );
    const ms = time('nearest of 2k polygons via the index', 20, () => idx.nearest(probe));
    console.log(`bench nearest speed-up over brute force: ${(brute / Math.max(ms, 0.001)).toFixed(0)}x`);
    expect(idx.nearest(probe)?.distanceM).toBeCloseTo(
      Math.min(...polys.map(([, g]) => geo.distanceM(probe, g))),
      6,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'geo-distance-2k',
          limit: 20,
          unit: 'ms',
          derivedFrom: 'interaction-to-next-paint: nearest-area lookup (index.nearest) while the user taps',
          device: 'x4',
          thread: 'main',
        }),
        ms,
      ),
    );
  });

  it('toWgs84 60k points', () => {
    time('toWgs84 60k points EPSG:25833', undefined, () => {
      for (let i = 0; i < N; i++)
        geo.toWgs84({ type: 'Point', coordinates: [390000 + i, 5820000 + i] }, 'EPSG:25833');
    });
  });
});
