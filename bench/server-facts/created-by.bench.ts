/**
 * Budget (WP-639, docs/12 "Run endpoint"): the creation quota check, `Facts.createdBy(actor, quota)`, is one fact
 * lookup inside a run, p95 < 1 ms at 60k features. Worst cases measured: the actor that created most features (the
 * import, the count stops at the quota) and a participant with many runs and no creations (every run is looked at).
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { createFacts } from '../../packages/server/src/store/facts';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;

describe('bench: server facts createdBy (quota)', () => {
  it('createdBy at 60k', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    // generate() writes features without the audit column: set it from the run that wrote each feature's `$type` (WP-306).
    db.exec(
      `UPDATE features SET created_by = (SELECT r.actor FROM observations o JOIN runs r ON r.id = o.run_id
         WHERE o.feature_id = features.id AND o.property = '$type' ORDER BY o.seq LIMIT 1)`,
    );
    const facts = createFacts(db, new Map());
    const busiest = db
      .prepare<{ actor: string; n: number }>(
        "SELECT actor, count(*) AS n FROM runs WHERE actor_kind = 'participant' GROUP BY actor ORDER BY n DESC LIMIT 1",
      )
      .get();
    expect(busiest).toBeDefined();
    const time = (actor: string, limit: number): { p95: number; found: number } => {
      const times: number[] = [];
      let found = 0;
      for (let i = 0; i < 2000; i++) {
        const t = performance.now();
        found = facts.createdBy(actor, limit);
        times.push(performance.now() - t);
      }
      return { p95: p95(times), found };
    };
    const importer = time('bench-import', 100);
    const worker = time(busiest?.actor ?? '', 100);
    console.log(
      `server facts createdBy 60k: import (stops at 100) p95 ${importer.p95.toFixed(3)} ms; participant with ${busiest?.n} runs p95 ${worker.p95.toFixed(3)} ms (found ${worker.found})`,
    );
    expect(importer.found).toBe(100);
    assertBudget(
      report(
        defineBudget({
          id: 'server-facts-created-by-p95',
          limit: 1,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: fact lookup inside a run, a small share of the 50 ms',
          device: 'server',
        }),
        Number(Math.max(importer.p95, worker.p95).toFixed(3)),
      ),
    );
    db.close();
  });
});
