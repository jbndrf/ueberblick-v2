/**
 * Budget (WP-534): erasure of one subject with 1,000 (feature, property) pairs in a 200k-observation project <= 2 s.
 * The trigger cost on normal runs is nil by construction: the guard triggers fire on UPDATE and DELETE of
 * `observations` and UPDATE of `runs.input`, and the run path only INSERTs (see bench/server-run for the p95).
 * Run: npm test -- -c bench/vitest.config.ts bench/erasure
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { planRedaction, type FeatureId } from '../../packages/core/src';
import { openProjectDb } from '../../packages/server/src/db/open';
import { createErasure } from '../../packages/server/src/erasure';

describe('bench: erasure', () => {
  it('1,000 pairs in a 200k-observation project within 2 s', () => {
    const db = openProjectDb(':memory:', 'bench');
    const NOW = '2026-09-30T10:00:00.000Z';
    const features = 20_000;
    const insertRun = db.prepare(
      `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
       VALUES (?, ?, 'participant', 'melden', 1, ?, ?, 'accepted')`,
    );
    const insertObs = db.prepare(
      'INSERT INTO observations (seq, run_id, feature_id, property, result) VALUES (?, ?, ?, ?, ?)',
    );
    let seq = 0;
    db.transaction(() => {
      const runs = 50_000;
      for (let r = 0; r < runs; r++) {
        // one in twenty runs is the subject's: 2,500 runs, 3,334-ish personal observations, like the spike
        const actor = r % 20 === 0 ? 'subject' : `p${r % 97}`;
        insertRun.run(`run-${r}`, actor, JSON.stringify({ phone: `0151-${r}`, species: 'oak' }), NOW);
        for (let k = 0; k < 4; k++) {
          const f = (r * 4 + k) % features;
          const personal = actor === 'subject' && k < 2;
          insertObs.run(
            ++seq,
            `run-${r}`,
            personal ? `s${r}-${k}` : `f${f}`,
            personal ? 'phone' : 'species',
            JSON.stringify(personal ? `0151-${r}` : 'oak'),
          );
        }
      }
    });
    const pairs = new Map<string, { featureId: FeatureId; property: string }>();
    for (const row of db
      .prepare<{ feature_id: string }>(
        `SELECT DISTINCT o.feature_id FROM observations o JOIN runs r ON r.id = o.run_id
         WHERE r.actor = 'subject' AND o.property = 'phone' LIMIT 1000`,
      )
      .all())
      pairs.set(row.feature_id, { featureId: row.feature_id as FeatureId, property: 'phone' });
    expect(pairs.size).toBe(1000);
    const total = (db.prepare('SELECT count(*) AS n FROM observations').get() as { n: number }).n;
    expect(total).toBe(200_000);

    const plan = planRedaction({ pairs: [...pairs.values()] });
    const t0 = performance.now();
    db.transaction(() => {
      insertRun.run('erasure', 'admin', JSON.stringify({ subject: 'subject' }), NOW);
      for (const o of plan.observations) insertObs.run(++seq, 'erasure', o.featureId, o.property, 'null');
      createErasure(db).erase({ subject: 'subject', purge: plan.purge, erasureRun: 'erasure', at: NOW });
    });
    const ms = performance.now() - t0;
    assertBudget(
      report(
        defineBudget({
          id: 'erasure-1000-pairs',
          limit: 2000,
          unit: 'ms',
          derivedFrom: 'WP-534: erasure of a subject with 1,000 pairs in a 200k-observation project',
          device: 'server',
        }),
        Math.round(ms),
      ),
    );
  });
});
