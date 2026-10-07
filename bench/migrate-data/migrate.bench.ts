/**
 * Budget (WP-301): converting a 60k-feature v3 export (about 2.3 runs per feature, references for every third
 * tree) and submitting it through the run store <= 10 min on the reference server. Also prints how much of it is
 * conversion and how much is the store.
 * Run: node scripts/ops/vitest-scoped.mjs run -c bench/vitest.config.ts bench/migrate-data
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { convertData, createIdMap, migrate, type RunBatch } from '../../apps/migrate/src/data';
import { syntheticExport, world } from '../../apps/migrate/src/data/testing';

const N = 60_000;

describe('bench: v3 data migration', () => {
  it('60k features through convertData and the run store', async () => {
    const w = world();
    const v3 = syntheticExport(N);
    const ids = createIdMap();
    let convertMs = 0;
    let runs = 0;
    async function* timed(): AsyncGenerator<RunBatch> {
      const it = convertData(v3, w.converted.mapping, {
        target: w.target,
        geo: w.geo,
        configVersion: w.configVersion,
        ids,
      })[Symbol.asyncIterator]();
      for (;;) {
        const t = performance.now();
        const next = await it.next();
        convertMs += performance.now() - t;
        if (next.done === true) return;
        runs += next.value.runs.length;
        yield next.value;
      }
    }
    const rss0 = process.memoryUsage().rss;
    const t0 = performance.now();
    const r = await migrate(w.store, timed(), ids);
    const totalMs = performance.now() - t0;
    expect(r.problems).toEqual([]);
    expect(r.accepted).toBe(runs);
    const rssMb = (process.memoryUsage().rss - rss0) / 1e6;
    console.log(
      `migrate ${N}: ${runs} runs in ${r.batches} batches, total ${(totalMs / 1000).toFixed(1)} s (convert ${(convertMs / 1000).toFixed(1)} s, store ${((totalMs - convertMs) / 1000).toFixed(1)} s), rss +${rssMb.toFixed(0)} MB`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'migrate-data-60k',
          limit: 600,
          unit: 's',
          derivedFrom:
            'run-endpoint-p95: a migration is batches of import runs; 60k features in 10 min (WP-301)',
          device: 'server',
        }),
        Number((totalMs / 1000).toFixed(1)),
      ),
    );
  }, 900_000);
});
