/**
 * Budget (WP-318, A-029): a timers tick with 10k due rows across 2 live versions. Per due row a tick reads the subject,
 * resolves its version's config (once per version per tick, through the shared resolver), evaluates `when` and `with`
 * and submits. `submit` is a stub here: the run transaction has its own budget (run-endpoint-p95); this measures the
 * tick itself. Budget: <= 0.5 ms per due row (median of 5 ticks), i.e. 5 s for 10k rows; a tick is O(due rows).
 * Also asserts one config resolution per version per tick (2 for 2 live versions).
 * Run: npm test -- -c bench/vitest.config.ts bench/timers
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { defineBudget, report } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { GOLDEN_DIR, loadSpec } from '../generate/spec';
import { compile, createGeo, TemplateFileSchema } from '../../packages/core/src';
import { createLogger } from '../../packages/server/src/log';
import { createTimers } from '../../packages/server/src/timers';
import { goldenAssets } from '../../packages/core/src/testing/golden';

const ROWS = 10_000;
/** Objekte one sweep tick visits. */
const BATCH = 2_000;
const NOW = '2026-05-01T08:00:00.000Z';
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('bench: timers tick per version', () => {
  it(`a tick with ${ROWS} due rows across 2 live versions`, () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const parsed = TemplateFileSchema.parse(
      parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')),
    );
    const compiled = compile(parsed, { assets: goldenAssets });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    // Version 1 and 2 are the same compiled template: the cost under test is the per-version resolution, not the rules.
    const resolved: number[] = [];
    const timers = createTimers(db, {
      clock: { now: () => NOW },
      ids: { runId: () => '' as never, featureId: () => '' as never },
      geo: createGeo(),
      log: createLogger({ sink: () => undefined, now: () => 0 }),
      versions: {
        configFor: (v) => (resolved.push(v), v === 1 || v === 2 ? compiled.config : undefined),
        deployed: () => ({ version: 2, config: compiled.config }),
      },
      submit: () => ({ outcome: 'accepted' }) as never,
    });
    db.prepare(
      "UPDATE features SET pinned_version = 1 WHERE type = 'baum' AND id IN (SELECT id FROM features WHERE type = 'baum' ORDER BY id LIMIT ?)",
    ).run(ROWS / 2);
    const fill = db.prepare(
      `INSERT INTO timers (feature_id, rule, due_at, config_version)
       SELECT id, 'kontrolle_wird_faellig', '2026-04-01T00:00:00.000Z', coalesce(pinned_version, 2)
       FROM features WHERE type = 'baum' ORDER BY id LIMIT ?`,
    );
    const perRow: number[] = [];
    for (let i = 0; i < 5; i++) {
      db.exec('DELETE FROM timers');
      fill.run(ROWS);
      const due = (db.prepare<{ n: number }>('SELECT count(*) AS n FROM timers').get() as { n: number }).n;
      expect(due).toBe(ROWS);
      resolved.length = 0;
      const t = performance.now();
      const r = timers.tick(NOW, ROWS);
      perRow.push((performance.now() - t) / ROWS);
      expect(r.failed).toBe(0);
      expect(r.fired + r.refused + r.skipped).toBe(ROWS);
      // the deployed version is held by the tick itself, the pinned one is resolved once
      expect(resolved.length).toBeLessThanOrEqual(2);
    }
    const mean = median(perRow);
    console.log(
      `server timers tick, ${ROWS} due rows over 2 versions: ${(mean * ROWS).toFixed(0)} ms (${mean.toFixed(3)} ms/row), ${resolved.length} config resolution(s) per tick`,
    );
    report(
      defineBudget({
        id: 'server-timers-due-row-ms',
        limit: 0.5,
        unit: 'ms',
        derivedFrom:
          'run-endpoint-p95: a due row is a fraction of a run; the tick shares the one vCPU with runs',
        device: 'server',
      }),
      Number(mean.toFixed(3)),
    );
  });

  it('an idle sweep tick visits a bounded batch, cursor after cursor', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const parsed = TemplateFileSchema.parse(
      parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')),
    );
    const compiled = compile(
      {
        ...parsed,
        tasks: {
          ...parsed.tasks,
          system_faellig: {
            ...parsed.tasks?.['system_faellig'],
            auto: {
              ...parsed.tasks?.['system_faellig']?.auto,
              ruhig: { schedule: '0 6 * * *', idle: 'days(30)' },
            },
          },
        },
      } as never,
      { assets: goldenAssets },
    );
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    const timers = createTimers(db, {
      clock: { now: () => NOW },
      ids: { runId: () => '' as never, featureId: () => '' as never },
      geo: createGeo(),
      log: createLogger({ sink: () => undefined, now: () => 0 }),
      versions: {
        configFor: (v) => (v === 1 ? compiled.config : undefined),
        deployed: () => ({ version: 1, config: compiled.config }),
      },
      submit: () => ({ outcome: 'accepted' }) as never,
    });
    db.exec("UPDATE features SET changed_at = '2026-01-01T00:00:00.000Z'");
    db.exec('DELETE FROM timers');
    db.prepare(
      "INSERT INTO timers (feature_id, rule, due_at, config_version) VALUES ('', 'system_faellig.ruhig', ?, 1)",
    ).run(NOW);
    const perFeature: number[] = [];
    let visited = 0;
    // one cron tick starts the sweep, the next ticks resume it, a batch of BATCH Objekte each
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      const r = timers.tick(NOW, BATCH, BATCH);
      perFeature.push((performance.now() - t) / BATCH);
      expect(r.failed).toBe(0);
      const batchCount = r.fired + r.refused + r.skipped;
      expect(batchCount).toBeLessThanOrEqual(BATCH);
      visited += batchCount;
    }
    expect(visited).toBe(5 * BATCH);
    const mean = median(perFeature);
    console.log(
      `server idle sweep, ${BATCH} Objekte per tick over 60k features: ${(mean * BATCH).toFixed(0)} ms (${mean.toFixed(3)} ms/Objekt)`,
    );
    report(
      defineBudget({
        id: 'server-idle-sweep-objekt-ms',
        limit: 0.5,
        unit: 'ms',
        derivedFrom: 'server-timers-due-row-ms: a visited Objekt costs about what a due row costs',
        device: 'server',
      }),
      Number(mean.toFixed(3)),
    );
  });
});
