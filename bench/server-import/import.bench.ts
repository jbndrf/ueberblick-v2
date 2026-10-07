/**
 * Budget (WP-111): importing 10k features (CSV, EPSG:25832 -> 4326, one atomic batch through the run store, rules
 * included) <= 30 s on the reference server. Also prints the GeoPackage export of the same 10k and the memory used.
 * Run: node scripts/ops/vitest-scoped.mjs run -c bench/vitest.config.ts bench/server-import
 */
import { createVersionCache } from '../../packages/server/src/store/run/config-for';
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import type { Key } from '../../packages/core/src';
import { buildGpkg } from '../../packages/server/src/io/export';
import { importFile, planImport } from '../../packages/server/src/io/import';
import { importer, TREE_MAPPING } from '../../packages/server/src/io/testkit';
import { createSyncService } from '../../packages/server/src/sync';
import { setup } from '../../packages/server/src/store/run/testkit';

const N = 10_000;

describe('bench: server import', () => {
  it('10k features from CSV in one atomic batch', () => {
    const ctx = setup();
    const deps = {
      config: ctx.config,
      configVersion: 1,
      actor: importer,
      ids: ctx.deps.ids,
      geo: ctx.deps.geo,
    };
    const lines = ['vit;x;y;z'];
    for (let i = 0; i < N; i++) {
      const x = (500000 + (i % 100) * 12.5).toFixed(2);
      const y = (5538630 + Math.floor(i / 100) * 12.5).toFixed(2);
      lines.push(`v${i % 5};${x};${y};${(100 + (i % 7)).toFixed(1)}`);
    }
    const data = lines.join('\n');
    const mapping = { ...TREE_MAPPING, sourceCrs: 'EPSG:25832' } as const;

    const tPlan = performance.now();
    const plan = planImport({ format: 'csv', data }, mapping, deps);
    const planMs = performance.now() - tPlan;
    expect(plan.problems).toEqual([]);

    const rss0 = process.memoryUsage().rss;
    const t0 = performance.now();
    const r = importFile(ctx.store, { format: 'csv', data }, mapping, deps);
    const importMs = performance.now() - t0;
    expect(r).toMatchObject({ outcome: 'accepted', imported: N });
    const rssMb = (process.memoryUsage().rss - rss0) / 1e6;

    const sync = createSyncService(ctx.db, {
      config: () => ({ version: 1, config: ctx.config }),
      at: () => ctx.config,
      versions: createVersionCache(() => ctx.config),
      clock: ctx.deps.clock,
      geo: ctx.deps.geo,
    });
    const t1 = performance.now();
    const built = buildGpkg(
      {
        db: ctx.db,
        config: ctx.config,
        actor: importer,
        visible: (a, al) => sync.visible(a, al),
        now: () => ctx.deps.clock.now(),
      },
      ['baum' as Key],
    );
    const exportMs = performance.now() - t1;
    built.dispose();

    console.log(
      `server import 10k: plan ${planMs.toFixed(0)} ms, import (plan+submit) ${importMs.toFixed(0)} ms, rss +${rssMb.toFixed(0)} MB, gpkg export ${exportMs.toFixed(0)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'import-10k',
          limit: 30,
          unit: 's',
          derivedFrom: 'run-endpoint-p95: an import is one batch of runs, 10k features in 30 s (WP-111)',
          device: 'server',
        }),
        Number((importMs / 1000).toFixed(2)),
      ),
    );
  }, 120_000);
});
