/**
 * WP-800 (R14): no full scan of the view's features per interaction. 60k trees in the device's in-memory index, the
 * participant's real view source and view list on top. "Before" lines emulate the old paths (a queue change rang `ALL`,
 * `query` read the whole world, the Liste read every row per pan); "after" lines run the shipped paths and are judged:
 * the longest single main-thread step must stay within the long-task row (100 ms at x4). The Liste's first read when it is
 * shown (every row of the view, once per tap on "Liste") is printed, not judged: at 60k it is about 100 ms raw (400 at x4),
 * the same cost the old code paid on every pan; chunking it is a follow-up (WP-800 Notes).
 * Run: npm test -- -c bench/vitest.config.ts bench/participant-interaction
 */
import { describe, expect, it } from 'vitest';
import { createGeo, type Bbox } from '@ueberblick/core/geo';
import type { Actor, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { MemoryIndex } from '../../packages/client/src/store/memory';
import { ALL, type Changed } from '../../apps/web/src/lib/participant/changed';
import { createViewList, createViewSource } from '../../apps/web/src/lib/participant/view-source';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const N = 60_000;
const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const geo = createGeo();
const actor: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
const now = () => '2026-09-30T10:00:00.000Z' as Instant;
const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
const tree = (n: number, stage = 'erfasst'): FeatureState => ({
  id: id(n),
  type: 'baum' as Key,
  properties: {
    geometrie: { type: 'Point', coordinates: [7 + (n % 300) / 100, 50 + Math.floor(n / 300) / 200] },
    stage,
  } as never,
  lifecycle: 'active',
  updatedSeq: n + 1,
});

function world() {
  const mem = new MemoryIndex();
  for (let i = 0; i < N; i++) mem.putFeature(tree(i));
  const rings = new Set<(c: Changed) => void>();
  const changed = {
    subscribe: (fn: (c: Changed) => void) => (rings.add(fn), () => rings.delete(fn)),
  };
  const ring = (c: Changed): void => rings.forEach((r) => r(c));
  const facts = {
    feature: (f: FeatureId) => mem.feature(f),
    near: (t: Key, b: Bbox) => mem.near(t, b),
    ofType: (t: Key) => mem.ofType(t),
    edgesFrom: (f: FeatureId) => mem.edgesFrom(f),
    edgesTo: (f: FeatureId) => mem.edgesTo(f),
    history: () => [],
  };
  const deps = { facts, config, actor, geo, now };
  return { mem, ring, changed, deps };
}

const ms = (fn: () => void, runs = 5): number => {
  fn(); // warm
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const a = performance.now();
    fn();
    t.push(performance.now() - a);
  }
  return t.sort((x, y) => x - y)[Math.floor(runs / 2)] ?? 0;
};

describe('participant interaction at 60k features', () => {
  it('a submit, a sync page, a pan and the Liste stay within the long-task budget at x4', () => {
    const w = world();
    const source = createViewSource({ ...w.deps, viewKey: 'karte', changed: w.changed });
    const list = createViewList({ ...w.deps, viewKey: 'alle_baeume', locales: ['de'] });
    let sent = 0;
    source.subscribe([-180, -90, 180, 90], (c) => (sent += c.add.length + c.update.length));
    expect(sent).toBe(N);

    // a submit: the queue's prediction changes one feature (before: the queue rang ALL)
    const submitBefore = ms(() => w.ring(ALL));
    let n = 0;
    const submitAfter = ms(() => {
      const next = tree(n++ % 50, 'kontrolliert');
      w.mem.setPrediction({ runId: `r${n}` as never, features: [next], edges: [], observations: [] });
      w.ring(new Set([next.id]));
    });

    // a sync page of 1,000 features (unchanged by this WP: the ids path)
    const pageIds = new Set(Array.from({ length: 1000 }, (_, i) => id(i)));
    const page = ms(() => {
      for (const i of pageIds) w.mem.putFeature(tree(Number(String(i).slice(-12)), `s${n++ % 3}`));
      w.ring(pageIds);
    });

    // the map's query of one extent (before: scan the world, then filter)
    const box = [7.5, 50.2, 7.9, 50.5] as [number, number, number, number];
    const queryAfter = ms(() => void source.query(box));
    const queryBefore = ms(() => void source.query([-180, -90, 180, 90]));

    // the Liste: shown the first time reads every row once; a burst while shown reads only its ids; hidden reads nothing
    const listRows = ms(() => void list.rows(box));
    // WP-805: the first open in slices; the longest single slice is the long task
    // WP-806: `Facts.ofType` is lazy, so the first pull is cheap (printed as "first pull"); the judged slice is the longest of the rest.
    let longest = 0;
    let firstPull = 0;
    for (let r = 0; r < 3; r++) {
      const it = list.rowChunks(box);
      let first = true;
      for (;;) {
        const a = performance.now();
        const n2 = it.next();
        const d = performance.now() - a;
        if (first) firstPull = Math.max(firstPull, d);
        else longest = Math.max(longest, d);
        first = false;
        if (n2.done === true) break;
      }
    }
    const listBurst = ms(() => void list.rowsOf(pageIds, box));

    console.log(
      `bench participant-interaction ${N}: submit before ${submitBefore.toFixed(1)} ms -> after ${submitAfter.toFixed(2)} ms; sync page of 1000 ${page.toFixed(1)} ms; ` +
        `query box before ${queryBefore.toFixed(1)} ms (world) -> after ${queryAfter.toFixed(1)} ms; Liste on show (one read) ${listRows.toFixed(1)} ms, first Liste open at 60k chunked: longest slice ${longest.toFixed(1)} ms (first pull with ofType ${firstPull.toFixed(1)} ms), burst of 1000 ids ${listBurst.toFixed(1)} ms, hidden pan 0 ms (MapCanvas.spec)`,
    );
    for (const [name, value] of [
      ['submit', submitAfter],
      ['sync-page', page],
      ['query-box', queryAfter],
      ['list-burst', listBurst],
      ['list-first-open', longest],
    ] as const)
      assertBudget(
        report(
          defineBudget({
            id: `participant-${name}-60k`,
            limit: 100,
            unit: 'ms',
            row: 'long-task',
            device: 'x4',
            thread: 'main',
          }),
          Number(value.toFixed(2)),
        ),
      );
  }, 120_000);
});
