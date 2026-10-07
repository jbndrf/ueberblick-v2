/**
 * Budget (docs/12 "Run endpoint"): one run including rules, end to end through the HTTP handler (session lookup, body
 * parse and Zod validation, store, response) p95 <= 50 ms at 60k features; WP-105's own line: the handler's overhead
 * over `store.submit` p95 <= 5 ms. Data as in server-run.bench.ts. Run: npm test -- -c bench/vitest.config.ts bench/server-run
 */
import { createVersionCache } from '../../packages/server/src/store/run/config-for';
import { goldenAssets } from '../../packages/core/src/testing/golden';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { GOLDEN_DIR, loadSpec } from '../generate/spec';
import {
  compile,
  createGeo,
  formApi,
  TemplateFileSchema,
  type FeatureId,
  type Key,
  type RunId,
} from '../../packages/core/src';
import { createStore, type Store } from '../../packages/server/src/store';
import { createLogger } from '../../packages/server/src/log';
import { createAuth, isAuthError } from '../../packages/server/src/auth';
import { openControlDb } from '../../packages/server/src/db/open';
import { createRunHandlers } from '../../packages/server/src/http';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;

describe('bench: run endpoint over HTTP', () => {
  it('end-to-end p95 and the overhead over store.submit at 60k features', async () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const parsed = TemplateFileSchema.parse(
      parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')),
    );
    const compiled = compile(parsed, { assets: goldenAssets });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    const config = compiled.config;
    let n = 0;
    const uuid = (p: number): string =>
      `${String(p).padStart(8, '0')}-0000-7000-8000-${String(++n).padStart(12, '0')}`;
    const store = createStore(db, {
      log: createLogger({ sink: () => undefined, now: () => Date.now() }),
      clock: { now: () => '2026-05-01T08:00:00.000Z' },
      ids: { runId: () => uuid(2) as RunId, featureId: () => uuid(3) as FeatureId },
      geo: createGeo(),
      limits: { ruleDepth: 8 },
      config: (v) => (v === 1 ? config : undefined),
      versions: createVersionCache((v) => (v === 1 ? config : undefined)),
      form: formApi,
    });
    let inner = 0;
    const timed: Store = {
      ...store,
      submit(run) {
        const t = performance.now();
        const r = store.submit(run);
        inner = performance.now() - t;
        return r;
      },
    };

    const control = openControlDb(':memory:');
    control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run('p1', 'bench', 'bench', 'x');
    const auth = createAuth({
      control,
      now: () => new Date(),
      participantRoles: () => ['kontrolle' as Key],
    });
    const session = auth.exchange(auth.issueCredential('p1', 'anna').token);
    if (isAuthError(session)) throw new Error(session.code);
    const handlers = createRunHandlers({
      auth,
      project: (key) => (key === 'bench' ? { id: 'p1', key } : undefined),
      store: () => timed,
      log: createLogger({ sink: () => undefined, now: () => 0 }),
    });

    const trees = db
      .prepare<{ id: string }>(
        `SELECT f.id AS id FROM features f
         JOIN edges e ON e.from_id = f.id AND e.relation = 'flaeche'
         WHERE f.type = 'baum' AND f.lifecycle IN ('active','completed') AND json_extract(f.properties, '$.stage') != 'erledigt'
         LIMIT 1000`,
      )
      .all();
    expect(trees.length).toBeGreaterThan(450);

    const post = async (i: number, id: string): Promise<{ total: number; inner: number }> => {
      const body = JSON.stringify({
        id: uuid(1),
        task: 'kontrolle',
        configVersion: 1,
        featureId: id,
        input: { vitalitaet: i % 2 === 0 ? 'v3' : 'v2', befund: `bench ${i}` },
      });
      const req = new Request('http://x/api/p/bench/runs', {
        method: 'POST',
        headers: { cookie: `ub_session_participant=${session.id}`, 'content-type': 'application/json' },
        body,
      });
      const t = performance.now();
      const res = await handlers.submit(req, { params: { project: 'bench' } });
      const total = performance.now() - t;
      const json = (await res.json()) as { outcome: string; refusal?: { message: string } };
      if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(json)}`);
      return { total, inner };
    };

    for (let i = 0; i < 30; i++) await post(i, (trees[i] as { id: string }).id);
    const totals: number[] = [];
    const overheads: number[] = [];
    for (let i = 0; i < 400; i++) {
      const r = await post(i, (trees[30 + i] as { id: string }).id);
      totals.push(r.total);
      overheads.push(r.total - r.inner);
    }
    const end = p95(totals);
    const over = p95(overheads);
    console.log(
      `run endpoint 60k: end to end p95 ${end.toFixed(1)} ms; handler overhead over store.submit p95 ${over.toFixed(2)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'run-endpoint-http-p95',
          limit: 50,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: the same row, measured through the HTTP handler (WP-105)',
          device: 'server',
        }),
        Number(end.toFixed(1)),
      ),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'run-endpoint-http-overhead-p95',
          limit: 5,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: handler overhead over store.submit (WP-105)',
          device: 'server',
        }),
        Number(over.toFixed(2)),
      ),
    );
    db.close();
  }, 300_000);
});
