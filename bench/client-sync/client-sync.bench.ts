/**
 * Budget (docs/12): a 60k-feature snapshot <= 20 s, no long task > 100 ms per page. The worker pulls
 * 60 pages of 1,000 features from an in-memory server into the real device store on fake-indexeddb
 * (much slower than a browser's IndexedDB, so the numbers are upper bounds). The next page is fetched
 * while the current one is applied. Run: npm test -- -c bench/vitest.config.ts client-sync
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { SYNC_PROTOCOL_VERSION, encodePage } from '../../packages/core/src/sync';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import type { Instant } from '../../packages/core/src/model';
import { openDeviceStore } from '../../packages/client/src/store/open';
import { fakeEnv, feature, memoryMarker } from '../../packages/client/src/store/test-env';
import {
  SYNC_PAGE_MAX_ROWS,
  createWorkerDecoder,
  decodePayload,
  decodingTransport,
} from '../../packages/client/src/sync/decode';
import type { MessagePortLike } from '../../packages/client/src/sync/decode';
import { createSyncWorker } from '../../packages/client/src/sync/worker';
import { FakeServer, memoryMeta } from '../../packages/client/src/sync/test-server';
import { MemoryIndex } from '../../packages/client/src/store/memory';
import { commitPlan, planPage } from '../../packages/client/src/store/plan';
import { docBudget, report } from '../harness/budget.mjs';

const PAGE = 1000;
const PAGES = 60;

describe('client-sync', () => {
  it('60k snapshot within 20 s, pages applied without long tasks', async () => {
    const server = new FakeServer();
    server.pageSize = PAGE;
    for (let n = 1; n <= PAGE * PAGES; n++) {
      const f = feature(n, ++server.seq, { species: `s-${n % 40}` });
      server.features.set(f.id, f);
    }
    const store = await openDeviceStore('bench', { env: fakeEnv(), marker: memoryMarker() });
    let worst = 0;
    const apply = store.applyPage.bind(store);
    store.applyPage = async (rows, cursor) => {
      const t = performance.now();
      const out = await apply(rows, cursor);
      worst = Math.max(worst, performance.now() - t);
      return out;
    };
    const worker = createSyncWorker({
      store,
      transport: server,
      meta: memoryMeta(),
      predictions: { rederive: () => Promise.resolve() },
      clock: { now: () => '2026-09-29T00:00:00Z' as Instant },
    });
    const t0 = performance.now();
    const r = await worker.pull();
    const totalS = (performance.now() - t0) / 1000;
    console.log(
      `client-sync: 60k snapshot in ${r.pages} pages: ${totalS.toFixed(1)} s (fake IDB), worst applyPage wall ${worst.toFixed(0)} ms`,
    );
    expect(store.featureIdsOfType('tree')).toHaveLength(PAGE * PAGES);
    // The client applies a whole snapshot: this is the device's share of "Full offline copy" (no network here).
    report(docBudget('offline-copy-60k', { device: 'x4', thread: 'worker' }), totalS);
  });

  it('decode in a real worker thread: worst main-thread stall per page', async () => {
    // a worker thread running the same decode step the browser worker runs (bundled from source)
    const dir = mkdtempSync(join(tmpdir(), 'ueb-decode-'));
    const entry = join(dir, 'entry.ts');
    writeFileSync(
      entry,
      `import { parentPort } from 'node:worker_threads';
       import { serveDecoder } from ${JSON.stringify(join(process.cwd(), 'packages/client/src/sync/decode'))};
       const port = { postMessage: (m) => parentPort.postMessage(m), onmessage: null };
       parentPort.on('message', (data) => port.onmessage({ data }));
       serveDecoder(port);`,
    );
    const out = join(dir, 'worker.mjs');
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: out,
      logLevel: 'silent',
    });
    const thread = new Worker(out);
    afterAll(() => void thread.terminate());
    const port: MessagePortLike = {
      postMessage: (m) => thread.postMessage(m),
      set onmessage(h) {
        thread.on('message', (data) => h?.({ data }));
      },
      get onmessage(): MessagePortLike['onmessage'] {
        return null;
      },
    };
    const decoder = createWorkerDecoder(port);

    const server = new FakeServer();
    server.pageSize = PAGE;
    for (let n = 1; n <= PAGE * PAGES; n++) {
      const f = feature(n, ++server.seq, { species: `s-${n % 40}` });
      server.features.set(f.id, f);
    }
    const raw = {
      fetchEncoded: async (req: Parameters<FakeServer['fetchPage']>[0]) =>
        JSON.stringify(encodePage(await server.fetchPage(req))),
    };

    // what the main thread would spend if it decoded inline (one page)
    const sample = await raw.fetchEncoded({ since: 0, scope: '', v: SYNC_PROTOCOL_VERSION });
    const t = performance.now();
    decodePayload(sample, SYNC_PAGE_MAX_ROWS);
    const inlineMs = performance.now() - t;

    const store = await openDeviceStore('bench-w', { env: fakeEnv(), marker: memoryMarker() });
    const worker = createSyncWorker({
      store,
      transport: decodingTransport(raw, decoder),
      meta: memoryMeta(),
      predictions: { rederive: () => Promise.resolve() },
      clock: { now: () => '2026-09-29T00:00:00Z' as Instant },
    });
    // event-loop probe: the longest gap between two 1 ms ticks = the longest main-thread block. It includes
    // fake-IndexedDB, which runs its transactions in JS on this thread; a browser's IndexedDB does not.
    let last = performance.now();
    let stall = 0;
    const probe = setInterval(() => {
      const now = performance.now();
      stall = Math.max(stall, now - last - 1);
      last = now;
    }, 1);
    const r = await worker.pull();
    clearInterval(probe);
    console.log(
      `client-sync: worker decode, ${r.pages} pages: inline decode of one page ${inlineMs.toFixed(0)} ms; worst main-thread stall during the pull ${stall.toFixed(0)} ms (includes fake-IDB apply)`,
    );
    expect(store.featureIdsOfType('tree')).toHaveLength(PAGE * PAGES);

    // The main-thread work the store does per page on a device: plan, the structured clone of every put
    // (IndexedDB clones synchronously), and the in-memory commit. The IndexedDB write itself is native and async.
    const mem = new MemoryIndex();
    let worst = 0;
    for (let p = 0; p < PAGES; p++) {
      const features = Array.from({ length: PAGE }, (_, i) =>
        feature(p * PAGE + i + 1, p + 1, { species: `s-${i % 40}` }),
      );
      const t0 = performance.now();
      const plan = planPage(mem, { features, edges: [], observations: [], tombstones: [], runs: [], people: [] });
      structuredClone(plan.featurePuts);
      commitPlan(mem, plan);
      worst = Math.max(worst, performance.now() - t0);
    }
    report(docBudget('long-task', { device: 'x4', thread: 'main' }), Number(worst.toFixed(1)));
  });
});
