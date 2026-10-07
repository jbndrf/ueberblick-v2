/**
 * WP-845 (R14): a view filter that follows one relation hop (`self.flaeche.name == 'Nord'`, the golden Baumkataster's
 * derived `flaeche` relation, one Fläche per tree) over 60k trees, for a participant. (a) the map's view pass (`queryChunks` over the world: the longest slice is asserted at x4, the whole walk logged), (b) the Liste's first open (`rowChunks`), longest slice. Both are main-thread work: judged against
 * the long-task row at x4 for the Liste, and against `filter-change-60k` (100 ms) for the map pass.
 * Median of 5 runs, load average logged. Run: npm test -- -c bench/vitest.config.ts bench/relation-hop-filter
 */
import { describe, expect, it } from 'vitest';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import { loadavg } from 'node:os';
import { createGeo, type Bbox } from '@ueberblick/core/geo';
import type { Actor, Edge, FeatureId, Instant, Key } from '@ueberblick/core/model';
import { compile } from '../../packages/core/src/schema/compile';
import { TemplateFileSchema } from '../../packages/core/src/schema/file';
import { goldenAssets, goldenYaml } from '@ueberblick/core/testing';
import { MemoryIndex } from '../../packages/client/src/store/memory';
import { createViewList, createViewSource } from '../../apps/web/src/lib/participant/view-source';
import { filteredSource } from '../../apps/web/src/lib/participant/sheets/filter/filtered-source';
import { createFilterController } from '../../apps/web/src/lib/participant/sheets/filter/filter-controller';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const N = 60_000;
const SPECIES = 100;
const RUNS = 5;
const HOP = "self.flaeche.name == 'Nord' && self.vitalitaet != 'v0'";
const NONE_PLAIN = "self.stage == 'nirgends'";
const NONE_HOP = "self.flaeche.name == 'nirgends'";
const PLAIN = "self.vitalitaet != 'v0' && self.hoehe_m != 7";
const actor: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;

function configWith(filter: string): CompiledConfig {
  const raw = structuredClone(goldenYaml('templates/baumkataster/1.0.0.yaml')) as {
    views: { alle_baeume: { source: { filter?: string } } };
  };
  raw.views.alle_baeume.source.filter = filter;
  const r = compile(TemplateFileSchema.parse(raw), { assets: goldenAssets });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
}

export function world(): MemoryIndex {
  const mem = new MemoryIndex();
  for (let s = 0; s < SPECIES; s++)
    mem.putFeature({
      id: id(s),
      type: 'flaeche' as Key,
      properties: {
        geometrie: {
          type: 'Polygon',
          coordinates: [
            [
              [7, 50],
              [8, 50],
              [8, 51],
              [7, 50],
            ],
          ],
        },
        name: s % 10 === 3 ? 'Nord' : `Fläche ${s}`,
      } as never,
      lifecycle: 'active',
      updatedSeq: s + 1,
    });
  for (let i = 0; i < N; i++) {
    const n = SPECIES + i;
    mem.putFeature({
      id: id(n),
      type: 'baum' as Key,
      properties: {
        geometrie: { type: 'Point', coordinates: [7 + (i % 300) / 100, 50 + Math.floor(i / 300) / 200] },
        stage: 'erfasst',
        vitalitaet: i % 5 === 0 ? 'v0' : 'v2',
        art: id(i % SPECIES),
      } as never,
      lifecycle: 'active',
      updatedSeq: n + 1,
    });
    const e: Edge = { from: id(n), relation: 'flaeche' as Key, to: id(i % SPECIES), derived: false };
    mem.putEdge(e, n + 1);
  }
  return mem;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

/** Median map pass and Liste longest slice (ms) of one view filter over the 60k world. */
function measure(mem: MemoryIndex, filter: string): { map: number; slice: number; list: number; rows: number } {
  const config = configWith(filter);
  const facts = {
    feature: (f: FeatureId) => mem.feature(f),
    near: (t: Key, b: Bbox) => mem.near(t, b),
    ofType: (t: Key) => mem.ofType(t),
    edgesFrom: (f: FeatureId, r?: Key) => mem.edgesFrom(f, r),
    edgesTo: (f: FeatureId, r?: Key) => mem.edgesTo(f, r),
    history: () => [],
  };
  const base = {
    facts,
    config,
    actor,
    geo: createGeo(),
    now: () => '2026-09-30T10:00:00.000Z' as Instant,
    viewKey: 'alle_baeume',
  };
  const source = createViewSource({ ...base, changed: { subscribe: () => () => undefined } });
  const list = createViewList({ ...base, locales: ['de'] });
  const everywhere: Bbox = [-180, -90, 180, 90];
  let rows = 0;
  const mapRuns = Array.from({ length: RUNS }, () => {
    const t0 = performance.now();
    rows = source.query(everywhere).length;
    return performance.now() - t0;
  });
  // the same pass in slices (what the map's first delivery and an ALL walk run): the longest one is the long task
  let sliceRows = 0;
  const sliceRuns = Array.from({ length: RUNS }, () => {
    let longest = 0;
    sliceRows = 0;
    const it = source.queryChunks(everywhere);
    for (;;) {
      const a = performance.now();
      const n = it.next();
      longest = Math.max(longest, performance.now() - a);
      if (n.done === true) break;
      sliceRows += n.value.length;
    }
    return longest;
  });
  expect(sliceRows).toBe(rows);
  let listRows = 0;
  const listRuns = Array.from({ length: RUNS }, () => {
    let longest = 0;
    listRows = 0;
    const it = list.rowChunks(undefined);
    let first = true;
    for (;;) {
      const a = performance.now();
      const n = it.next();
      const d = performance.now() - a;
      if (!first) longest = Math.max(longest, d);
      first = false;
      if (n.done === true) break;
      listRows += n.value.length;
    }
    return longest;
  });
  expect(rows).toBe(listRows);
  return { map: median(mapRuns), slice: median(sliceRuns), list: median(listRuns), rows };
}

describe('view filter with a relation hop at 60k', () => {
  it('map view pass and Liste first open stay within budget', () => {
    const mem = world();
    measure(mem, HOP); // warm-up
    const nonePlain = measure(mem, NONE_PLAIN);
    const noneHop = measure(mem, NONE_HOP);
    expect(nonePlain.rows + noneHop.rows).toBe(0);
    const plain = measure(mem, PLAIN);
    const hop = measure(mem, HOP);
    const line = `bench relation-hop-filter ${N}: plain rows ${plain.rows} map ${plain.map.toFixed(1)} ms list ${plain.list.toFixed(1)} ms | hop rows ${hop.rows} map ${hop.map.toFixed(1)} ms (x4 ${(hop.map * 4).toFixed(0)}, one sync walk) longest slice ${hop.slice.toFixed(1)} ms (x4 ${(hop.slice * 4).toFixed(0)}; plain ${plain.slice.toFixed(1)}) list ${hop.list.toFixed(1)} ms (x4 ${(hop.list * 4).toFixed(0)}) | reject-all pass: one property ${nonePlain.map.toFixed(1)} ms, one hop ${noneHop.map.toFixed(1)} ms, hop cost ${(((noneHop.map - nonePlain.map) * 1000) / N).toFixed(2)} us/feature, load ${loadavg()[0]?.toFixed(2)}`;
    console.log(line);
    process.stderr.write(`${line}\n`);
    // the map pass runs in slices (WP-847): the longest slice is the long task; the whole walk is logged
    assertBudget(
      report(
        defineBudget({
          id: 'relation-hop-map-pass-slice-60k',
          limit: 100,
          unit: 'ms',
          row: 'filter-change-60k',
          device: 'x4',
          thread: 'main',
        }),
        Number(hop.slice.toFixed(2)),
      ),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'relation-hop-list-first-open-60k',
          limit: 100,
          unit: 'ms',
          row: 'long-task',
          device: 'x4',
          thread: 'main',
        }),
        Number(hop.list.toFixed(2)),
      ),
    );
  }, 300_000);
});

/**
 * WP-848: a sheet-filter change over the 60k map (`filteredSource.reapply`, both phases: hiding the Objektart removes 60k,
 * showing it adds 60k again). The longest task is the longest gap of a `setTimeout(0)` probe running beside it, so a
 * synchronous walk counts whole and a sliced one by its longest slice.
 */
async function longestTask(trigger: () => void, done: () => boolean): Promise<number> {
  let last = performance.now();
  let max = 0;
  let stop = false;
  const tick = (): void => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
    if (!stop) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  trigger();
  while (!done()) await new Promise((r) => setTimeout(r, 0));
  stop = true;
  await new Promise((r) => setTimeout(r, 1));
  return max;
}

describe('sheet filter change at 60k (WP-848)', () => {
  it('reapply walks in slices: the longest task stays within the filter-change budget at x4', async () => {
    const mem = world();
    const config = configWith(HOP);
    const facts = {
      feature: (f: FeatureId) => mem.feature(f),
      near: (t: Key, b: Bbox) => mem.near(t, b),
      ofType: (t: Key) => mem.ofType(t),
      edgesFrom: (f: FeatureId, r?: Key) => mem.edgesFrom(f, r),
      edgesTo: (f: FeatureId, r?: Key) => mem.edgesTo(f, r),
      history: () => [],
    };
    const source = createViewSource({
      facts,
      config,
      actor,
      geo: createGeo(),
      now: () => '2026-09-30T10:00:00.000Z' as Instant,
      viewKey: 'alle_baeume',
      changed: { subscribe: () => () => undefined },
    });
    const controller = createFilterController();
    const wrapped = filteredSource(source, (f) => mem.feature(f), config, controller);
    let shown = 0;
    const stop = wrapped.subscribe([-180, -90, 180, 90], (c) => {
      shown += c.add.length - c.remove.length;
    });
    await new Promise((r) => setTimeout(r, 1000)); // the first delivery
    const rows = shown;
    expect(rows).toBeGreaterThan(1000);
    const hide: number[] = [];
    const reveal: number[] = [];
    for (let i = 0; i < 3; i++) {
      hide.push(await longestTask(() => controller.setType('baum' as Key, false), () => shown === 0));
      reveal.push(await longestTask(() => controller.setType('baum' as Key, true), () => shown === rows));
    }
    stop();
    const worst = Math.max(median(hide), median(reveal));
    const line = `bench sheet-filter-change ${N}: rows ${rows} hide longest task ${median(hide).toFixed(1)} ms, show ${median(reveal).toFixed(1)} ms (x4 ${(worst * 4).toFixed(0)}), load ${loadavg()[0]?.toFixed(2)}`;
    console.log(line);
    process.stderr.write(`${line}\n`);
    assertBudget(
      report(
        defineBudget({
          id: 'sheet-filter-reapply-slice-60k',
          limit: 100,
          unit: 'ms',
          row: 'filter-change-60k',
          device: 'x4',
          thread: 'main',
        }),
        Number(worst.toFixed(2)),
      ),
    );
  }, 300_000);
});
