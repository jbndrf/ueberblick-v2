/**
 * WP-819 (R14): the first open of the Liste at 60k trees with an active view filter ("meine_aufgaben" of the golden
 * Baumkataster: `self.zustaendig == actor.id && self.faellig_am <= today()`, two properties). The filter runs per
 * feature in `accepts`; the longest slice must stay within the long-task row (100 ms at x4).
 * Run: npm test -- -c bench/vitest.config.ts bench/participant-list
 */
import { describe, expect, it } from 'vitest';
import { createGeo, type Bbox } from '@ueberblick/core/geo';
import type { Actor, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { MemoryIndex } from '../../packages/client/src/store/memory';
import { createViewList } from '../../apps/web/src/lib/participant/view-source';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const N = 60_000;
const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const actor: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
const tree = (n: number): FeatureState => ({
  id: id(n),
  type: 'baum' as Key,
  properties: {
    geometrie: { type: 'Point', coordinates: [7 + (n % 300) / 100, 50 + Math.floor(n / 300) / 200] },
    stage: 'erfasst',
    zustaendig: n % 4 === 0 ? 'anna' : 'bert',
    faellig_am: n % 3 === 0 ? '2026-01-01' : '2027-01-01',
  } as never,
  lifecycle: 'active',
  updatedSeq: n + 1,
});

describe('filtered Liste first open at 60k', () => {
  it('the longest slice stays within the long-task row at x4', async () => {
    const mem = new MemoryIndex();
    for (let i = 0; i < N; i++) mem.putFeature(tree(i));
    const facts = {
      feature: (f: FeatureId) => mem.feature(f),
      near: (t: Key, b: Bbox) => mem.near(t, b),
      ofType: (t: Key) => mem.ofType(t),
      edgesFrom: (f: FeatureId) => mem.edgesFrom(f),
      edgesTo: (f: FeatureId) => mem.edgesTo(f),
      history: () => [],
    };
    const now = () => '2026-09-30T10:00:00.000Z' as Instant;
    const list = createViewList({
      facts,
      config,
      actor,
      geo: createGeo(),
      now,
      viewKey: 'meine_aufgaben',
      locales: ['de'],
    });
    const box = undefined; // no extent: every feature of the type is read
    const runs: number[] = [];
    let rows = 0;
    for (let r = 0; r < 5; r++) {
      let longest = 0;
      rows = 0;
      const it = list.rowChunks(box);
      let first = true;
      for (;;) {
        const a = performance.now();
        const n = it.next();
        const d = performance.now() - a;
        if (!first) longest = Math.max(longest, d);
        first = false;
        if (n.done === true) break;
        rows += n.value.length;
      }
      runs.push(longest);
    }
    runs.sort((x, y) => x - y);
    const median = runs[2] ?? 0;
    console.log(
      `bench participant-list filtered ${N}: rows ${rows}, longest slice per run ${runs.map((x) => x.toFixed(1)).join('/')} ms (median ${median.toFixed(1)}), load ${(await import('node:os')).loadavg()[0]?.toFixed(2)}`,
    );
    expect(rows).toBeGreaterThan(0);
    assertBudget(
      report(
        defineBudget({
          id: 'participant-list-filtered-first-open-60k',
          limit: 100,
          unit: 'ms',
          row: 'long-task',
          device: 'x4',
          thread: 'main',
        }),
        Number(median.toFixed(2)),
      ),
    );
  }, 120_000);
});
