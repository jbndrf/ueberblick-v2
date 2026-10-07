/**
 * Budget (B-020, WP-683): mirroring a 10,000-record stream is paged (page of 200, one page held at a time) and
 * no page apply is a long task (<= 100 ms per page at the x4 factor, docs/12 `long-task`); appending to the
 * outbox is O(1) (the append p95 stays within the interaction-to-next-paint row, and the last thousand appends
 * cost about as much as the first thousand). fake-indexeddb runs in JS on the same thread, so the numbers are
 * upper bounds. Run: npm test -- -c bench/vitest.config.ts bench/client-tooldata
 */
import { describe, expect, it } from 'vitest';
import { createClock } from '../../packages/core/src/testing';
import { fakeEnv } from '../../packages/client/src/store/test-env';
import { idbBackend } from '../../packages/client/src/tooldata/backend-idb';
import { memoryBackend } from '../../packages/client/src/tooldata/backend-memory';
import { openToolDataStore } from '../../packages/client/src/tooldata/store';
import { createToolData } from '../../packages/client/src/tooldata/service';
import { FakeToolServer, T0 } from '../../packages/client/src/tooldata/tooldata.testing';
import { fakeTimers } from '../../packages/client/src/queue/queue.testing';
import { defineBudget, docBudget, report } from '../harness/budget.mjs';

const RECORDS = 10_000;
const PAGE = 100;
const APPENDS = 10_000;

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;

async function boot(mem = false) {
  const server = new FakeToolServer(['chat']);
  const store = await openToolDataStore(mem ? memoryBackend() : idbBackend(fakeEnv(), 'bench'));
  let id = 0;
  const data = createToolData({
    store,
    transport: server,
    available: () => ['chat'],
    self: () => 'me',
    clock: createClock(T0),
    newId: () => `b-${++id}`,
    timers: fakeTimers(),
    doorbell: { subscribe: () => () => undefined },
    pageLimit: PAGE,
    onError: (e) => {
      throw e;
    },
  });
  return { server, store, data };
}

describe('client tool data', () => {
  it('mirrors 10,000 records in pages without long tasks and with one page held', async () => {
    const { server, store, data } = await boot();
    for (let i = 0; i < RECORDS; i++) server.post('chat', 'anna', `message ${i}`);
    let maxPage = 0;
    const times: number[] = [];
    const real = server.page.bind(server);
    let t = 0;
    server.page = async (tool, after, limit) => {
      if (t) times.push(performance.now() - t); // time between a page answer and the next request = its apply
      const r = await real(tool, after, limit);
      if (r.kind === 'ok') maxPage = Math.max(maxPage, r.value.records.length);
      t = performance.now();
      return r;
    };
    const start = performance.now();
    await data.pull('chat');
    const total = performance.now() - start;
    expect(store.records('chat')).toHaveLength(RECORDS);
    expect(maxPage).toBe(PAGE); // one page at a time, never more
    // B-010: the first page (cold JIT) is an info line; the rest are judged
    const first = times[0] as number;
    const worst = Math.max(...times.slice(1));
    process.stdout.write(
      `client-tooldata: mirrored ${RECORDS} in ${times.length + 1} pages, ${total.toFixed(0)} ms total, page apply p95 ${p95(times).toFixed(1)} ms, worst of the rest ${worst.toFixed(1)} ms (first ${first.toFixed(1)} ms), max page ${maxPage}\n`,
    );
    report(
      docBudget('long-task', { id: 'tooldata-mirror-page-apply', device: 'x4', thread: 'worker' }),
      Number(worst.toFixed(1)),
    );
  });

  for (const mem of [true, false]) {
    it(`appends in O(1) on ${mem ? 'memory' : 'fake IndexedDB'}`, async () => {
      const { data } = await boot(mem);
      const h = data.handle('chat');
      const times: number[] = [];
      for (let i = 0; i < APPENDS; i++) {
        const t = performance.now();
        await h.append(`message ${i}`);
        times.push(performance.now() - t);
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const first = mean(times.slice(0, 1000));
      const last = mean(times.slice(-1000));
      process.stdout.write(
        `client-tooldata: append (${mem ? 'memory' : 'fake IDB'}) p95 ${p95(times).toFixed(2)} ms, mean first 1000 ${first.toFixed(3)} ms, last 1000 ${last.toFixed(3)} ms (${APPENDS} appends)\n`,
      );
      // our code is O(1): on the memory backend the last thousand cost about what the first did. fake-indexeddb
      // itself slows down with the store size (a real IndexedDB is a B-tree), so it is held to the p95 only.
      if (mem)
        report(
          defineBudget({
            id: 'tooldata-append-growth',
            limit: 3,
            unit: 'ratio',
            derivedFrom:
              'O(1) append (B-020): the last 1,000 of 10,000 appends over the first 1,000 (floored at 0.02 ms)',
            device: 'measured',
          }),
          Number((last / Math.max(first, 0.02)).toFixed(2)),
        );
      else
        report(
          defineBudget({
            id: 'tooldata-append-p95',
            limit: 50,
            unit: 'ms',
            derivedFrom: 'interaction-to-next-paint 200 ms row: the outbox write of one ctx.data.append',
            device: 'x4',
            thread: 'worker',
          }),
          Number(p95(times).toFixed(2)),
        );
    });
  }
});
