/**
 * Budget (WP-363): 10k CSV rows through the import endpoint (multipart upload, atomic job, rules included) <= 30 s
 * until the job is done, and the response with the job id comes back at once (<= 1 s after the upload was read).
 * Also prints the skip-mode step length per batch size (the longest time the event loop is held), which chose `IMPORT_BATCH`.
 * Run: npm run bench -- bench/server-import
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { createAdminImportHandlers, createImportService } from '../../packages/server/src/http/admin-import';
import { submitPlan, planImport } from '../../packages/server/src/io/import';
import { importer, TREE_MAPPING, importSetup } from '../../packages/server/src/io/testkit';
import type { Principal } from '../../packages/server/src/auth/contract';
import { setup } from '../../packages/server/src/store/run/testkit';

const N = 10_000;
const mapping = { ...TREE_MAPPING, sourceCrs: 'EPSG:25832' } as const;
const csv = (n: number): string => {
  const lines = ['vit;x;y;z'];
  for (let i = 0; i < n; i++) {
    const x = (500000 + (i % 100) * 12.5).toFixed(2);
    const y = (5538630 + Math.floor(i / 100) * 12.5).toFixed(2);
    lines.push(`v${i % 5};${x};${y};${(100 + (i % 7)).toFixed(1)}`);
  }
  return lines.join('\n');
};

describe('bench: import endpoint', () => {
  it('10k CSV rows through POST import, atomic', async () => {
    const ctx = setup();
    const service = createImportService({
      db: () => ctx.db,
      store: () => ctx.store,
      clock: ctx.deps.clock,
      ids: ctx.deps.ids,
      geo: ctx.deps.geo,
    });
    const handlers = createAdminImportHandlers({
      authorizeAdmin: (_p, key) => ({ projectKey: key }),
      deployed: () => ({ version: 1, config: ctx.config }),
      service,
    });
    const form = new FormData();
    form.set('file', new File([csv(N)], 'trees.csv'));
    form.set('mapping', JSON.stringify(mapping));
    const t0 = performance.now();
    const res = await handlers.start({
      request: new Request('http://x/import', { method: 'POST', body: form }),
      params: { project: 'demo' },
      principal: { kind: 'admin', id: 'a1' } as unknown as Principal,
    });
    const answerMs = performance.now() - t0;
    expect(res.status).toBe(202);
    await service.idle();
    const totalMs = performance.now() - t0;
    const n = ctx.db.prepare<{ n: number }>('SELECT count(*) AS n FROM features').get()?.n;
    expect(n).toBe(N);
    console.log(`import endpoint 10k: answer ${answerMs.toFixed(0)} ms, job done ${totalMs.toFixed(0)} ms`);
    assertBudget(
      report(
        defineBudget({
          id: 'import-http-10k',
          limit: 30,
          unit: 's',
          derivedFrom:
            'import-10k: the endpoint adds an upload and a job row to the 30 s of the batch (WP-363)',
          device: 'server',
        }),
        Number((totalMs / 1000).toFixed(2)),
      ),
    );
  }, 120_000);

  it.each([25, 100, 500])(
    'skip mode, batch of %i: longest step',
    (batchSize) => {
      const { ctx, deps } = importSetup();
      void importer;
      const plan = planImport({ format: 'csv', data: csv(2000) }, mapping, deps, { mode: 'skip' });
      const steps = submitPlan(ctx.store, plan, { mode: 'skip', batchSize });
      let longest = 0;
      let t = performance.now();
      for (let r = steps.next(); !r.done; r = steps.next()) {
        longest = Math.max(longest, performance.now() - t);
        t = performance.now();
      }
      console.log(`skip step, batch ${batchSize}: longest ${longest.toFixed(1)} ms`);
      if (batchSize === 100)
        assertBudget(
          report(
            defineBudget({
              id: 'import-skip-step',
              limit: 100,
              unit: 'ms',
              derivedFrom:
                'long-task: a skip-mode step must not hold the event loop longer than 100 ms (WP-363)',
              device: 'server',
            }),
            Number(longest.toFixed(1)),
          ),
        );
    },
    60_000,
  );
});
