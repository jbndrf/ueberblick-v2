/**
 * Budget (docs/12 "Run endpoint"): one run including rules, p95 <= 50 ms at 60k features on the server code; this WP's
 * own line: a batch of 30 new features <= 150 ms. Data: the seeded bench generator (60k features, derived edges), the
 * store on top of it with the baumkataster 1.0.0 config (kontrolle -> rule run -> measure, verschieben -> derived
 * edges recomputed, erfassen in a batch). Run: npm test -- -c bench/vitest.config.ts bench/server-run
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, DOC_BUDGETS, defineBudget, report, type Budget } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import type { Actor, FeatureId, Json, Key, Run } from '../../packages/core/src';
import { benchBlobs, seedCompiledConfig } from './seed-config';
import { projectStoresFor } from '../../packages/server/src/http/shared';
import { createLogger } from '../../packages/server/src/log';

let n = 0;
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;
const anna: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
const vera: Actor = { id: 'vera', kind: 'participant', roles: ['verwaltung' as Key] };

describe('bench: server run transaction', () => {
  it('single run incl. rules p95 and a batch of 30 at 60k features', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    seedCompiledConfig(db);
    // The store is built the way production builds it: one shared factory wires clock, ids, geo, limits, config, form.
    const store = projectStoresFor({
      clock: { now: () => new Date().toISOString() },
      log: createLogger({ sink: () => undefined, now: () => Date.now() }),
      projectDb: () => db,
      blobs: benchBlobs(),
    })('bench');
    const uuid = (p: number): string =>
      `${String(p).padStart(8, '0')}-0000-7000-8000-${String(++n).padStart(12, '0')}`;

    // Trees inside an area (kontrolle binds `self.flaeche`) that are not finished.
    const trees = db
      .prepare<{ id: string; x: number; y: number }>(
        `SELECT f.id AS id, f.anchor_lon AS x, f.anchor_lat AS y FROM features f
         JOIN edges e ON e.from_id = f.id AND e.relation = 'flaeche'
         WHERE f.type = 'baum' AND f.lifecycle IN ('active','completed') AND json_extract(f.properties, '$.stage') != 'erledigt'
         LIMIT 3000`,
      )
      .all();
    expect(trees.length).toBeGreaterThan(500);

    const run = (task: string, who: Actor, input: Record<string, Json>, feature?: string): Run =>
      ({
        id: uuid(1),
        task: task as Key,
        actor: who,
        configVersion: 1,
        input,
        ...(feature ? { featureId: feature as FeatureId } : {}),
      }) as Run;
    const timeOf = (r: Run): number => {
      const t = performance.now();
      const res = store.submit(r);
      const ms = performance.now() - t;
      if (res.outcome !== 'accepted')
        throw new Error(`${r.task}: ${res.refusal.code} ${res.refusal.message}`);
      return ms;
    };

    for (let i = 0; i < 30; i++)
      timeOf(
        run('kontrolle', anna, { vitalitaet: 'v2', befund: `warm ${i}` }, (trees[i] as { id: string }).id),
      );

    const samples: number[] = [];
    let ruleRuns = 0;
    for (let i = 0; i < 400; i++) {
      const t = trees[30 + i] as { id: string; x: number; y: number };
      const v3 = i % 2 === 0; // half of the runs trigger the rule run that creates a measure
      const before = (
        db.prepare<{ n: number }>('SELECT count(*) n FROM runs WHERE caused_by IS NOT NULL').get() as {
          n: number;
        }
      ).n;
      if (i % 4 === 3)
        samples.push(
          timeOf(
            run(
              'verschieben',
              vera,
              { geometrie: { type: 'Point', coordinates: [t.x + 0.0004, t.y + 0.0004] } },
              t.id,
            ),
          ),
        );
      else
        samples.push(
          timeOf(run('kontrolle', anna, { vitalitaet: v3 ? 'v3' : 'v2', befund: `bench ${i}` }, t.id)),
        );
      ruleRuns +=
        (
          db.prepare<{ n: number }>('SELECT count(*) n FROM runs WHERE caused_by IS NOT NULL').get() as {
            n: number;
          }
        ).n - before;
    }
    const single = p95(samples);
    console.log(
      `server run 60k: single run (kontrolle / verschieben, ${ruleRuns} rule runs) p95 ${single.toFixed(1)} ms, median ${[...samples].sort((a, b) => a - b)[200]?.toFixed(1)} ms`,
    );
    assertBudget(report(DOC_BUDGETS['run-endpoint-p95'] as Budget, Number(single.toFixed(1))));

    const batches: number[] = [];
    for (let b = 0; b < 15; b++) {
      const runs = Array.from({ length: 30 }, (_, i) => {
        const t = trees[600 + b * 30 + i] as { x: number; y: number };
        return run('erfassen', vera, {
          vitalitaet: 'v2',
          geometrie: { type: 'Point', coordinates: [t.x + 0.0002, t.y - 0.0002] },
        });
      });
      const t0 = performance.now();
      const res = store.submitBatch(runs);
      batches.push(performance.now() - t0);
      if (res.outcome !== 'accepted') throw new Error(res.refusal.message);
    }
    const batch = p95(batches);
    console.log(`server run 60k: batch of 30 new features p95 ${batch.toFixed(1)} ms`);
    assertBudget(
      report(
        defineBudget({
          id: 'run-batch-30',
          limit: 150,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: a batch of 30 new features is one request (WP-104)',
          device: 'server',
        }),
        Number(batch.toFixed(1)),
      ),
    );
    db.close();
  }, 300_000);
});
