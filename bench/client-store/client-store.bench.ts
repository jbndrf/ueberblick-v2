/**
 * Budget (docs/12): applying a 1,000-feature snapshot page <= 100 ms of main-thread work, and
 * hydrating 60k features fits the cold-start budget. fake-indexeddb is far slower than a browser's
 * IndexedDB, so the wall time is an upper bound; `planMs` is the synchronous CPU part (plan, memory
 * commit, request queueing) that would block a thread. Seeded data, nothing committed.
 * Run: npm test -- -c bench/vitest.config.ts client-store
 */
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import type { FeatureId, FeatureState, Key, RunId } from '../../packages/core/src/model';
import { MemoryIndex } from '../../packages/client/src/store/memory';
import { commitPlan, planPage } from '../../packages/client/src/store/plan';
import { openDeviceStore } from '../../packages/client/src/store/open';
import type { PageRows } from '../../packages/client/src/store/contract';
import { fakeEnv, memoryMarker } from '../../packages/client/src/store/test-env';

const PAGE = 1000;
const PAGES = 60;
/** Cold-JIT pages run first and are reported apart, not judged (B-010); the browser bench judges cold start. */
const WARMUP = 1;

function page(p: number): PageRows {
  const features: FeatureState[] = [];
  const observations = [];
  for (let i = 0; i < PAGE; i++) {
    const n = p * PAGE + i;
    const id = `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
    features.push({
      id,
      type: 'tree' as Key,
      properties: {
        geometry: { type: 'Point', coordinates: [13 + n / 1e5, 52, 30] },
        species: `s-${n % 40}`,
        h: n % 300,
      },
      lifecycle: 'active',
      updatedSeq: n + 1,
    });
    for (let k = 0; k < 3; k++)
      observations.push({
        featureId: id,
        property: 'h',
        result: k,
        phenomenonTime: null,
        resultTime: null,
        seq: n * 3 + k + 1,
        runId: `018f0000-0000-7000-9000-${String(n * 3 + k).padStart(12, '0')}` as RunId,
      });
  }
  const edges = features.map((f, i) => ({
    from: f.id,
    relation: 'parent' as Key,
    to: features[(i + 1) % PAGE]?.id ?? f.id,
    derived: false,
    updatedSeq: f.updatedSeq,
  }));
  const runs = observations.map((o) => ({
    id: o.runId,
    task: 'kontrolle',
    actor: 'p1',
    clientTime: 1,
    receivedAt: 2,
    seq: o.seq,
    causedBy: null,
  }));
  return { features, edges, observations, tombstones: [], runs, people: [{ id: 'p1', name: 'Anna' }] };
}

const ACTIVITY_FEATURE = `018f0000-0000-7000-8000-${String(0).padStart(12, '0')}` as FeatureId;

/** A delta with 5 properties x 10 observations on one feature, each from its own run. */
function fullHistoryPage(): PageRows {
  const base = PAGE * PAGES * 3 + 10;
  const observations = [];
  for (let k = 0; k < 50; k++)
    observations.push({
      featureId: ACTIVITY_FEATURE,
      property: `p${k % 5}`,
      result: k,
      phenomenonTime: null,
      resultTime: null,
      seq: base + k,
      runId: `018f0000-0000-7000-9000-${String(base + k).padStart(12, '0')}` as RunId,
    });
  const runs = observations.map((o) => ({
    id: o.runId,
    task: 'kontrolle',
    actor: 'p1',
    clientTime: 1,
    receivedAt: 2,
    seq: o.seq,
    causedBy: null,
  }));
  return {
    features: [],
    edges: [],
    observations,
    tombstones: [],
    runs,
    people: [{ id: 'p1', name: 'Anna' }],
  };
}

function renameAll(mem: MemoryIndex): void {
  for (const f of [...mem.features.values()])
    mem.putFeature({ ...f, properties: { ...f.properties, name: `Baum ${f.updatedSeq}` } });
}

describe('client store', () => {
  it('applies 1,000-feature pages and hydrates 60k features', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const store = await openDeviceStore('bench', { env, marker });
    const mem = new MemoryIndex();
    let worstPlan = 0;
    let warmupPlan = 0;
    let worstWall = 0;
    const t0 = performance.now();
    for (let p = 0; p < PAGES; p++) {
      const rows = page(p);
      const a = performance.now();
      commitPlan(mem, planPage(mem, rows));
      const took = performance.now() - a;
      if (p < WARMUP) warmupPlan = Math.max(warmupPlan, took);
      else worstPlan = Math.max(worstPlan, took);
      const b = performance.now();
      await store.applyPage(rows, { kind: 'snapshot', cursor: (p + 1) * PAGE, scopeFingerprint: 's' });
      worstWall = Math.max(worstWall, performance.now() - b);
    }
    const totalMs = performance.now() - t0;
    await store.applyPage(fullHistoryPage(), {
      kind: 'delta',
      cursor: PAGE * PAGES + 1,
      scopeFingerprint: 's',
    });
    store.close();
    const h0 = performance.now();
    const reopened = await openDeviceStore('bench', { env, marker });
    const hydrateMs = performance.now() - h0;
    console.log(
      `client-store: 60k features in ${PAGES} pages: total ${totalMs.toFixed(0)} ms (fake IDB), ` +
        `worst page wall ${worstWall.toFixed(0)} ms, worst plan+commit CPU ${worstPlan.toFixed(1)} ms (warm-up page ${warmupPlan.toFixed(1)} ms, not judged), ` +
        `hydrate 60k ${hydrateMs.toFixed(0)} ms, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`,
    );
    expect(reopened.featureIdsOfType('tree')).toHaveLength(PAGE * PAGES);
    // opening a feature sheet: the activity of a feature with a full history (5 properties x 10), cold
    const sheetId = ACTIVITY_FEATURE;
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = performance.now();
      await reopened.warmActivity(sheetId);
      const obs = reopened.observationsOf(sheetId);
      for (const o of obs) reopened.runMeta(o.runId);
      samples.push(performance.now() - a);
      if (i === 0) expect(obs.length).toBe(53);
    }
    const coldMs = samples[0] ?? 0;
    const warmMs = Math.max(...samples.slice(1));
    console.log(
      `client-store: activity of one feature (53 observations) next to 60k features: cold ${coldMs.toFixed(1)} ms (fake IDB), warm worst ${warmMs.toFixed(2)} ms`,
    );
    report(
      defineBudget({
        id: 'client-store-activity-open',
        limit: 200,
        unit: 'ms',
        derivedFrom: 'inp: open feature <= 200 ms; the activity read is a part of opening the sheet',
        device: 'x4',
        thread: 'main',
      }),
      Number(coldMs.toFixed(1)),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'client-store-plan-worst',
          limit: 100,
          unit: 'ms',
          derivedFrom: 'long-task: plan plus commit of one page, off the main thread',
          device: 'x4',
          thread: 'worker',
        }),
        Number(worstPlan.toFixed(1)),
      ),
    );
    report(
      defineBudget({
        id: 'client-store-hydrate-60k',
        limit: 5000,
        unit: 'ms',
        derivedFrom:
          'cold-start-60k: hydrate the store from IndexedDB is a part of cold start (limit 5 s = the whole row)',
        device: 'x4',
        thread: 'worker',
      }),
      Math.round(hydrateMs),
    );
  });

  it('the in-memory mirror of 60k features and 60k edges retains <= 60 MB', () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    gc();
    const before = process.memoryUsage().heapUsed;
    const mem = new MemoryIndex();
    for (let p = 0; p < PAGES; p++) commitPlan(mem, planPage(mem, page(p)));
    gc();
    const mb = (process.memoryUsage().heapUsed - before) / 1e6;
    console.log(`client-store: mirror retained heap for 60k features + 60k edges: ${mb.toFixed(1)} MB`);
    expect(mem.features.size).toBe(PAGE * PAGES);
    report(
      defineBudget({
        id: 'client-store-mirror-heap',
        limit: 60,
        unit: 'MB',
        derivedFrom: 'heap-60k: the index mirror is a part of the 150 MB heap',
        device: 'measured',
      }),
      Number(mb.toFixed(1)),
    );
    expect(mb).toBeLessThanOrEqual(60);
  });
  it('Facts.near on 60k features returning <= 50 hits takes <= 1 ms p95', () => {
    const mem = new MemoryIndex();
    for (let p = 0; p < PAGES; p++) commitPlan(mem, planPage(mem, page(p)));
    const times: number[] = [];
    let hits = 0;
    let maxHits = 0;
    for (let i = 0; i < 2000; i++) {
      const x = 13 + ((i * 7919) % 60_000) / 1e5;
      const t = performance.now();
      const n = [...mem.near('tree' as Key, [x, 51.9999, x + 4e-4, 52.0001])].length;
      times.push(performance.now() - t);
      hits += n;
      maxHits = Math.max(maxHits, n);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] as number;
    console.log(
      `client-store: near 60k p95 ${p95.toFixed(3)} ms (mean ${(hits / 2000).toFixed(1)}, max ${maxHits} hits)`,
    );
    expect(maxHits).toBeLessThanOrEqual(50);
    assertBudget(
      report(
        defineBudget({
          id: 'client-store-near-p95',
          limit: 1,
          unit: 'ms',
          derivedFrom: 'long-task: one near lookup inside plan, far below the 100 ms task budget',
          device: 'x4',
          thread: 'worker',
        }),
        Number(p95.toFixed(3)),
      ),
    );
  });

  it('searchText on 60k features: build at open, one incremental add, keystroke <= 50 ms at x4, index heap', () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    const mem = new MemoryIndex();
    for (let p = 0; p < PAGES; p++) commitPlan(mem, planPage(mem, page(p)));
    // distinct names as in a real cadastre, so the build sorts about 60k tokens
    renameAll(mem);
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    const src = [{ type: 'tree' as Key, property: 'name' }];
    const b0 = performance.now();
    mem.indexText('tree' as Key, 'name'); // what the app does at open, once
    const buildMs = performance.now() - b0;
    gc();
    const mb = (process.memoryUsage().heapUsed - before) / 1e6;
    const a0 = performance.now();
    for (let i = 0; i < 1000; i++)
      mem.putFeature({
        id: `018f0000-0000-7000-8000-9${String(i).padStart(11, '0')}` as FeatureId,
        type: 'tree' as Key,
        properties: { name: `Neu ${i * 7919}` },
        lifecycle: 'active',
        updatedSeq: 100_000 + i,
      });
    const addMs = (performance.now() - a0) / 1000;
    const times: number[] = [];
    // a typing session with a limit of 20 results
    for (let i = 0; i < 400; i++)
      for (const q of ['b', 'ba', 'baum', `Baum ${i * 137}`, 'zz']) {
        const t = performance.now();
        mem.searchText(src, q, 20);
        times.push(performance.now() - t);
      }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] as number;
    const worst = times[times.length - 1] as number;
    console.log(
      `client-store: searchText 60k p95 ${p95.toFixed(3)} ms worst ${worst.toFixed(3)} ms; ` +
        `index build at open ${buildMs.toFixed(0)} ms, one incremental add ${addMs.toFixed(4)} ms, ` +
        `index heap ${mb.toFixed(1)} MB`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'client-store-search-keystroke',
          limit: 50,
          unit: 'ms',
          derivedFrom: 'INP: a keystroke to results, 50 ms at x4',
          device: 'x4',
          thread: 'main',
        }),
        Number(worst.toFixed(3)),
      ),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'client-store-text-build-60k',
          limit: 1000,
          unit: 'ms',
          derivedFrom:
            'cold-start-60k: the text index build is a part of opening the store (hydrate is 5 s at most; the build gets 1 s)',
          device: 'x4',
          thread: 'worker',
        }),
        Math.round(buildMs),
      ),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'client-store-text-add',
          limit: 1,
          unit: 'ms',
          derivedFrom:
            'long-task: one incremental index add inside a page commit, far below the 100 ms task budget',
          device: 'x4',
          thread: 'worker',
        }),
        Number(addMs.toFixed(4)),
      ),
    );
    // the mirror (60 MB) plus the index still fits the 150 MB heap row
    expect(mb).toBeLessThanOrEqual(15);
  });
});
