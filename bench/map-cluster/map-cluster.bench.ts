/**
 * Budgets (docs/12-performance-budgets.md, WP-521), 60k features:
 *  - initial cluster build (worker side) <= 1 s
 *  - one-feature update on the main thread (delta + post) <= 16 ms
 * Run: npm test -- -c bench/vitest.config.ts bench/map-cluster
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { ClusterClient } from '../../packages/ui/src/map/cluster/client';
import { ClusterIndex } from '../../packages/ui/src/map/cluster/index-core';
import { splitChange, CHUNK_SIZE, yieldToMain } from '../../packages/ui/src/map/maplibre/chunk';
import { pointFeature } from '../../packages/ui/src/map/test-helpers';
import type { FromWorker } from '../../packages/ui/src/map/cluster/protocol';

const N = 60_000;
/** The 1-minute load average, printed next to every timing on this shared host. */
const load = (): string => (loadavg()[0] ?? 0).toFixed(1);
const features = Array.from({ length: N }, (_, i) =>
  pointFeature(`f${i}`, 5 + ((i * 7919) % 10_000) / 1000, 47 + ((i * 104729) % 8_000) / 1000),
);

describe('map-cluster', () => {
  it('initial build of 60k anchors <= 1500 ms at x4 (B-007)', () => {
    // Median of 3 COLD first builds, each in a fresh node process (WP-579, lead decision; method aligned with
    // WP-563's median-of-samples): on a device the user meets the first build, so a warm JIT must not be judged.
    // Two variants run interleaved (WP-584): `cold` is the first build in a fresh worker; `warmed` is the same
    // after `warmUp()`, which the real worker runs at start while it waits for the first delivery. The budget
    // judges `warmed` (the state the user meets), `cold` is reported beside it.
    const dir = mkdtempSync(join(tmpdir(), 'map-cluster-'));
    const runs: Record<'cold' | 'warmed', { ms: number; warm: number; count: number }[]> = {
      cold: [],
      warmed: [],
    };
    try {
      const bundle = join(dir, 'index-core.cjs');
      const base = new URL('../../packages/ui/src/map/cluster/', import.meta.url).pathname;
      buildSync({
        stdin: {
          contents: "export { ClusterIndex } from './index-core'; export { warmUp } from './warm';",
          resolveDir: base,
          loader: 'ts',
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: bundle,
        logLevel: 'silent',
      });
      const child = `
        const { ClusterIndex, warmUp } = require(${JSON.stringify(bundle)});
        const points = Array.from({ length: ${N} }, (_, i) => ({ id: 'f' + i, lng: 5 + ((i * 7919) % 10000) / 1000, lat: 47 + ((i * 104729) % 8000) / 1000 }));
        const w0 = performance.now();
        if (process.argv[1] === 'warmed') warmUp();
        const warm = performance.now() - w0;
        const index = new ClusterIndex();
        const t0 = performance.now();
        index.apply(points, [], []);
        const items = index.query([5, 47, 15, 55], 6);
        console.log(JSON.stringify({ ms: performance.now() - t0, warm, count: items.length }));`;
      for (let i = 0; i < 3; i++) {
        for (const variant of ['cold', 'warmed'] as const) {
          const r = spawnSync(process.execPath, ['-e', child, variant], { encoding: 'utf8' });
          if (r.status !== 0) throw new Error(`cold build failed: ${r.stderr}`);
          runs[variant].push(JSON.parse(r.stdout) as { ms: number; warm: number; count: number });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const median = (v: 'cold' | 'warmed') =>
      [...runs[v]].sort((a, b) => a.ms - b.ms)[1] as { ms: number; warm: number; count: number };
    const cold = median('cold');
    const { ms, warm, count } = median('warmed');
    console.log(
      `bench map-cluster build+query 60k: cold median ${cold.ms.toFixed(0)} ms of ${runs.cold.map((r) => r.ms.toFixed(0)).join('/')}; warmed median ${ms.toFixed(0)} ms of ${runs.warmed.map((r) => r.ms.toFixed(0)).join('/')} (warm-up itself ${warm.toFixed(0)} ms, off the critical path in the worker; budget 1500 at x4, B-007), ${count} items; load ${load()}`,
    );
    // The unwarmed first build is judged on its own against the real limit, so a cold regression cannot hide
    // behind the warmed number.
    assertBudget(
      report(
        defineBudget({
          id: 'map-cluster-build-60k-cold',
          limit: 1500,
          unit: 'ms',
          derivedFrom:
            'cold-start-60k: cluster build is the largest part of the first-markers path; 1500 ms per B-007',
          device: 'x4',
          thread: 'worker',
        }),
        Math.round(cold.ms),
      ),
    );
    // The warmed build keeps the WP-584 headroom target: 300 ms raw, 1200 at x4.
    assertBudget(
      report(
        defineBudget({
          id: 'map-cluster-build-60k',
          limit: 1200,
          unit: 'ms',
          derivedFrom:
            'cold-start-60k: cluster build after the worker warm-up; 1500 ms per B-007 less 20 % headroom (WP-584)',
          device: 'x4',
          thread: 'worker',
        }),
        Math.round(ms),
      ),
    );
  });

  it('one-feature update: main-thread cost <= 16 ms', () => {
    // The transport only counts: the worker side runs off the main thread, so it is not measured here.
    let posted = 0;
    const client = new ClusterClient({
      post: () => {
        posted++;
      },
      onMessage: () => undefined,
      close: () => undefined,
    });
    client.apply({ add: features, update: [], remove: [] });
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      client.apply({ add: [], update: [pointFeature('f10', 8 + i / 100, 50)], remove: [] });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[25] ?? 0;
    console.log(
      `bench map-cluster one-update main thread: median ${median.toFixed(3)} ms (budget 16), posts ${posted}`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'map-cluster-update-main-thread',
          limit: 16,
          unit: 'ms',
          derivedFrom: 'long-task: one frame (16 ms) for one update on the main thread',
          device: 'x4',
          thread: 'main',
        }),
        Number(median.toFixed(3)),
      ),
    );
  });

  it('style keys: 60k build with one property, and a new-key update payload', () => {
    const withProps = features.map((f, i) =>
      pointFeature(f.id, f.anchor[0], f.anchor[1], { vitalitaet: i % 5, art: 'Linde' }),
    );
    const posts: string[] = [];
    const index = new ClusterIndex();
    const client = new ClusterClient({
      post: (m) => {
        if (m.type === 'apply') index.apply(m.add, m.update, m.remove);
        else if (m.type === 'keys') {
          posts.push(m.type);
          index.setKeys(m.keys, m.values);
        }
      },
      onMessage: () => undefined,
      close: () => undefined,
    });
    client.setKeys(['vitalitaet'], []);
    client.apply({ add: withProps, update: [], remove: [] });
    const t0 = performance.now();
    const items = index.query([5, 47, 15, 55], 6);
    const build = performance.now() - t0;
    const t1 = performance.now();
    client.setKeys(['art'], withProps);
    const mainMs = performance.now() - t1;
    const t2 = performance.now();
    index.query([5, 47, 15, 55], 17);
    const rebuild = performance.now() - t2;
    console.log(
      `bench map-cluster with keys: build+query ${build.toFixed(0)} ms (budget 1500 at x4, B-007), ${items.length} items; new key: main thread ${mainMs.toFixed(1)} ms, worker rebuild ${rebuild.toFixed(0)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'map-cluster-build-60k-props',
          limit: 1500,
          unit: 'ms',
          derivedFrom: 'cold-start-60k: cluster build with property keys, same limit as without',
          device: 'x4',
          thread: 'worker',
        }),
        Math.round(build),
      ),
    );
    expect(posts).toEqual(['keys', 'keys']);
  });

  it('initial delivery in chunks: longest chunk on the main thread, and one-update cost in the worker', () => {
    const index = new ClusterIndex();
    const client = new ClusterClient({
      post: (m) => {
        if (m.type === 'apply') index.apply(m.add, m.update, m.remove);
      },
      onMessage: () => undefined,
      close: () => undefined,
    });
    let longest = 0;
    for (const part of splitChange({ add: features, update: [], remove: [] }, CHUNK_SIZE)) {
      const t0 = performance.now();
      client.apply(part);
      longest = Math.max(longest, performance.now() - t0);
    }
    index.query([5, 47, 15, 55], 6);
    const builds = index.builds;
    const t1 = performance.now();
    client.apply({ add: [], update: [pointFeature('f10', 9, 50)], remove: [] });
    const items = index.query([5, 47, 15, 55], 6);
    const oneUpdate = performance.now() - t1;
    console.log(
      `bench map-cluster chunks of ${CHUNK_SIZE}: longest main-thread chunk ${longest.toFixed(1)} ms (x4: ${(longest * 4).toFixed(0)}); one update + query in worker ${oneUpdate.toFixed(1)} ms, builds ${builds} -> ${index.builds}, ${items.length} items`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'map-cluster-chunk-main-thread',
          limit: 100,
          unit: 'ms',
          row: 'long-task',
          device: 'x4',
          thread: 'main',
        }),
        Number(longest.toFixed(1)),
      ),
    );
    // WP-706 (round 2): an update that MOVES a held point drops the built index, and the query rebuilds it
    // once in the worker (so the 'one update' time above includes one rebuild). Not zero, not one per point.
    expect(index.builds).toBe(builds + 1);
  });

  it('setKeys with a new key at 60k: longest main-thread task <= 100 ms at x4 (25 ms raw)', async () => {
    const withProps = features.map((f, i) =>
      pointFeature(f.id, f.anchor[0], f.anchor[1], { vitalitaet: i % 5, art: 'Linde' }),
    );
    let reply: (m: FromWorker) => void = () => undefined;
    const client = new ClusterClient(
      {
        post: (m) => {
          if (m.type === 'query') reply({ type: 'clusters', reqId: m.reqId, items: [] });
        },
        onMessage: (l) => {
          reply = l;
        },
        close: () => undefined,
      },
      // A task is the time between two yields: from the call, or from a resume, to the next yield.
      async () => {
        longest = Math.max(longest, performance.now() - start);
        await yieldToMain();
        start = performance.now();
      },
    );
    let longest = 0;
    let start = performance.now();
    client.setKeys(['vitalitaet'], []);
    client.apply({ add: withProps, update: [], remove: [] });
    start = performance.now();
    client.setKeys(['art'], withProps);
    await client.query([5, 47, 15, 55], 6); // resolves after the last chunk
    longest = Math.max(longest, performance.now() - start);
    console.log(
      `bench map-cluster setKeys new key 60k: longest main-thread task ${longest.toFixed(1)} ms (x4: ${(longest * 4).toFixed(1)}; limit 100 at x4 = 25 raw, docs/12 long-task); load ${load()}`,
    );
    assertBudget(
      report(
        defineBudget({
          // The docs/12 row is 100 ms ON THE PHONE: the raw value is multiplied by 4, so the limit is the row's 100
          // (a 25 here would count the factor twice). WP-584.
          id: 'map-cluster-setkeys-main-thread',
          limit: 100,
          unit: 'ms',
          row: 'long-task',
          device: 'x4',
          thread: 'main',
        }),
        Number(longest.toFixed(1)),
      ),
    );
  });
});
