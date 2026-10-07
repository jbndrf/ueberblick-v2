/**
 * Budget (WP-108): recompute the derived edges of one changed polygon over 60k features <= 20 ms (p95); it derives
 * from the run endpoint row of docs/12 (recompute is a part of a run that moves a polygon). Data: the seeded bench
 * generator (60k features, about 800 polygons, `baum.flaeche` and `baum.randlage` derived edges). Worst case measured:
 * the polygon's edges are deleted first, so every one of them is written again.
 * Second line: an idle `timers.tick` over 60k timer rows (`timers` has no `due_at` index, so it is a scan) <= 20 ms.
 * The harness judges the values (a breach on a busy machine is UNRELIABLE, bench/README.md); the tests do not.
 * Also a golden check: the recomputed edges equal a brute-force test of every tree (3k features).
 * Run: npm test -- -c bench/vitest.config.ts bench/server-derive
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { defineBudget, report } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { GOLDEN_DIR, loadSpec } from '../generate/spec';
import {
  compile,
  createGeo,
  TemplateFileSchema,
  type FeatureId,
  type Geometry,
} from '../../packages/core/src';
import { foldSchema } from '../../packages/core/src/schema/compile';
import { createDerive } from '../../packages/server/src/derive';
import { createLogger } from '../../packages/server/src/log';
import { createTimers } from '../../packages/server/src/timers';
import { goldenAssets } from '../../packages/core/src/testing/golden';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;

describe('bench: server derive', () => {
  it('recompute for one changed polygon at 60k features', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const parsed = TemplateFileSchema.parse(
      parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')),
    );
    const compiled = compile(parsed, { assets: goldenAssets });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    const schema = foldSchema(compiled.config, 1);
    const derive = createDerive(db, {
      geo: createGeo(),
      deployed: () => 1,
      at: () => ({
        schema,
        condition: () => {
          throw new Error('the bench template has no derive condition');
        },
      }),
    });
    const polygons = db
      .prepare<{ id: string }>(
        "SELECT id FROM features WHERE type = 'flaeche' AND lifecycle IN ('active','completed') ORDER BY id LIMIT 60",
      )
      .all();
    const drop = db.prepare('DELETE FROM edges WHERE to_id = ? AND derived = 1');
    const count = db.prepare<{ n: number }>(
      'SELECT count(*) AS n FROM edges WHERE to_id = ? AND derived = 1',
    );

    const times: number[] = [];
    let edges = 0;
    for (const p of polygons) {
      const before = (count.get(p.id) as { n: number }).n;
      drop.run(p.id);
      const t = performance.now();
      const r = derive.recompute([p.id as FeatureId]);
      times.push(performance.now() - t);
      expect(r.put).toBeGreaterThanOrEqual(before); // the generator stores `flaeche` only; recompute also writes `randlage`
      edges += before;
    }
    // the untouched case: nothing to change, the candidates are still tested
    const idle: number[] = [];
    for (const p of polygons) {
      const t = performance.now();
      derive.recompute([p.id as FeatureId]);
      idle.push(performance.now() - t);
    }
    const worst = p95(times);
    console.log(
      `server derive 60k: ${polygons.length} polygons, mean ${(edges / polygons.length).toFixed(1)} edges; write-back p95 ${worst.toFixed(2)} ms, unchanged p95 ${p95(idle).toFixed(2)} ms`,
    );
    report(
      defineBudget({
        id: 'server-derive-polygon-p95',
        limit: 20,
        unit: 'ms',
        derivedFrom: 'run-endpoint-p95: recompute for one moved polygon is a part of a run',
        device: 'server',
      }),
      Number(worst.toFixed(2)),
    );
  });
  it('the recomputed derived edges equal a brute-force test of every tree against the polygon (golden, 3k)', () => {
    const { db } = generate({ seed: 4711, features: 3_000 });
    const parsed = TemplateFileSchema.parse(
      parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')),
    );
    const compiled = compile(parsed, { assets: goldenAssets });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    const geo = createGeo();
    const derive = createDerive(db, {
      geo,
      deployed: () => 1,
      at: () => ({
        schema: foldSchema(compiled.config, 1),
        condition: () => {
          throw new Error('the bench template has no derive condition');
        },
      }),
    });
    const shape = (properties: string): Geometry => JSON.parse(properties).geometrie as Geometry;
    const trees = db
      .prepare<{ id: string; properties: string }>(
        "SELECT id, properties FROM features WHERE type = 'baum' AND lifecycle IN ('active','completed')",
      )
      .all();
    const polygons = db
      .prepare<{ id: string; properties: string }>(
        "SELECT id, properties FROM features WHERE type = 'flaeche' AND lifecycle IN ('active','completed') ORDER BY id LIMIT 20",
      )
      .all();
    const derived = db.prepare<{ k: string }>(
      "SELECT from_id || '|' || relation || '|' || to_id AS k FROM edges WHERE to_id = ? AND derived = 1 ORDER BY k",
    );
    const drop = db.prepare('DELETE FROM edges WHERE to_id = ? AND derived = 1');
    let total = 0;
    for (const p of polygons) {
      const poly = shape(p.properties);
      const want: string[] = [];
      for (const t of trees) {
        const g = shape(t.properties);
        if (geo.test('within', g, poly)) want.push(`${t.id}|flaeche|${p.id}`);
        if (geo.test('intersects', g, poly)) want.push(`${t.id}|randlage|${p.id}`);
      }
      drop.run(p.id);
      derive.recompute([p.id as FeatureId]);
      expect(derived.all(p.id).map((r) => r.k)).toEqual(want.sort());
      total += want.length;
    }
    expect(total).toBeGreaterThan(0);
  });
  it('an idle timers tick over 60k timer rows', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const parsed = TemplateFileSchema.parse(
      parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')),
    );
    const compiled = compile(parsed, { assets: goldenAssets });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    const insert = db.prepare(
      'INSERT INTO timers (feature_id, rule, due_at) SELECT id, ?, ? FROM features WHERE type = ?',
    );
    insert.run('kontrolle_wird_faellig', '2030-01-01T00:00:00.000Z', 'baum');
    const rows = (db.prepare<{ n: number }>('SELECT count(*) AS n FROM timers').get() as { n: number }).n;
    const timers = createTimers(db, {
      clock: { now: () => '2026-05-01T08:00:00.000Z' },
      ids: { runId: () => '' as never, featureId: () => '' as never },
      geo: createGeo(),
      log: createLogger({ sink: () => undefined, now: () => 0 }),
      versions: {
        configFor: (v) => (v === 1 ? compiled.config : undefined),
        deployed: () => ({ version: 1, config: compiled.config }),
      },
      submit: () => {
        throw new Error('nothing is due');
      },
    });
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      const r = timers.tick('2026-05-01T08:00:00.000Z');
      times.push(performance.now() - t);
      expect(r.fired + r.failed).toBe(0);
    }
    const idle = p95(times);
    console.log(`server timers idle tick over ${rows} rows: p95 ${idle.toFixed(2)} ms`);
    report(
      defineBudget({
        id: 'server-timers-idle-tick-p95',
        limit: 20,
        unit: 'ms',
        derivedFrom: 'run-endpoint-p95: a tick shares the one vCPU with runs',
        device: 'server',
      }),
      Number(idle.toFixed(2)),
    );
  });
});
