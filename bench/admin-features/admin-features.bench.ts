/**
 * Budget (docs/12 line `admin-features-p95`): the admin feature list (E-7) answers in <= 300 ms p95 at 60k features of
 * one type, including its slowest shapes: the first page sorted by an UNINDEXED text property (full scan plus top-N),
 * a substring search over the text properties, a distinct query, a deep keyset page and a combined filter. Server code,
 * measured as called by the handler (parse, SQL, count, JSON).
 * Data: 60k `baum` rows written directly into a project database (one type, every lifecycle state, the audit columns).
 * Run: npm test -- -c bench/vitest.config.ts bench/admin-features
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { golden, setup } from '../../packages/server/src/store/run/testkit';
import { reconcileIndexes } from '../../packages/server/src/deploy/index-ddl';
import { writeDeps } from '../../packages/server/src/http/admin-features/testkit';
import { createAdminFeatureHandlers, type FeaturePage } from '../../packages/server/src/http/admin-features';

const N = 60_000;
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;
const WORDS = ['Pilz', 'Ast', 'Rinde', 'Wurzel', 'Krone', 'Stamm', 'Moos', 'Riss', 'Schnitt', 'Fäulnis'];

describe('bench: admin feature list', () => {
  it('first page, search, distinct, deep page and combined filter p95 on 60k features', async () => {
    const ctx = setup({ config: golden('musterstadt-plain') });
    const { db } = ctx;
    reconcileIndexes(db, ctx.config.file);
    const stages = ['erfasst', 'kontrolliert', 'gefaellt'];
    const put = db.prepare(
      `INSERT INTO features (id, type, config_version, properties, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
       VALUES (?, 'baum', 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      for (let i = 0; i < N; i++) {
        const day = String(1 + (i % 28)).padStart(2, '0');
        const props = {
          stage: stages[i % 3],
          befund: `${WORDS[i % 10]} ${WORDS[(i * 7) % 10]} ${i % 997}`,
          hoehe_m: ((i * 37) % 4000) / 10,
          zustaendig: `p${i % 40}`,
          faellig_am: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${day}`,
          kontrolle_faellig: i % 2 === 0,
        };
        put.run(
          `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
          JSON.stringify(props),
          7 + (i % 100) / 1000,
          50 + (i % 77) / 1000,
          i + 1,
          i % 50 === 0 ? 'deleted' : i % 17 === 0 ? 'archived' : 'active',
          `user${i % 25}`,
          `2026-01-${day}T08:00:00.000Z`,
          `2026-02-${day}T08:00:00.000Z`,
        );
      }
    });
    db.exec('ANALYZE');
    const handlers = createAdminFeatureHandlers({
      authorizeAdmin: (_p, key) => ({ projectKey: key }),
      db: () => db,
      deployed: () => ({ version: 1, config: ctx.config }),
      ...writeDeps(ctx), // not exercised: the bench reads
    });
    const principal = { kind: 'admin', id: 'a' } as never;
    const call = (path: string) => ({
      request: new Request(`http://x/api/admin/p/p/${path}`),
      params: { project: 'p' },
      principal,
    });
    const time = async (n: number, path: (i: number) => string, distinct = false): Promise<number[]> => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        const r = distinct ? handlers.distinct(call(path(i))) : handlers.list(call(path(i)));
        await r.text();
        out.push(performance.now() - t);
        if (r.status !== 200) throw new Error(`${r.status} ${path(i)}`);
      }
      return out;
    };
    const first = (await (
      await handlers.list(call('features?type=baum&sort=befund&limit=50'))
    ).json()) as FeaturePage;
    const cursor = first.next as string;
    const shapes: [string, number[]][] = [];
    const run = async (name: string, n: number, path: (i: number) => string, distinct = false) => {
      await time(3, path, distinct);
      shapes.push([name, await time(n, path, distinct)]);
    };
    await run('first page, unindexed text sort', 30, () => 'features?type=baum&sort=befund&limit=50');
    await run(
      'first page, unindexed text sort desc',
      30,
      () => 'features?type=baum&sort=befund&dir=desc&limit=50',
    );
    await run('first page, indexed text sort', 30, () => 'features?type=baum&sort=zustaendig&limit=50');
    await run('first page, indexed date sort', 30, () => 'features?type=baum&sort=faellig_am&limit=50');
    await run('first page, default (id) order', 30, () => 'features?type=baum&limit=50');
    await run('first page, createdAt sort', 30, () => 'features?type=baum&sort=$created_at&limit=50');
    await run('deep keyset page', 30, () => `features?type=baum&sort=befund&limit=50&cursor=${cursor}`);
    await run('search (common word)', 30, (i) => `features?type=baum&q=${WORDS[i % 10]}&limit=50`);
    await run('search (rare)', 30, () => 'features?type=baum&q=krone%20moos%20996&limit=50');
    await run(
      'search + filter + sort',
      30,
      () => 'features?type=baum&q=pilz&filter.stage=erfasst,gefaellt&sort=hoehe_m&limit=50',
    );
    await run('distinct stage', 30, () => 'features/distinct?type=baum&column=stage', true);
    await run('distinct befund (capped)', 30, () => 'features/distinct?type=baum&column=befund', true);
    await run(
      'distinct stage with search',
      30,
      () => 'features/distinct?type=baum&column=stage&q=pilz',
      true,
    );
    for (const [name, xs] of shapes)
      process.stderr.write(`admin features: ${name} p95 ${p95(xs).toFixed(1)} ms\n`);
    const worst = Math.max(...shapes.map(([, xs]) => p95(xs)));
    assertBudget(
      report(
        defineBudget({
          id: 'admin-features-p95',
          limit: 300,
          unit: 'ms',
          derivedFrom:
            'bbox-query-p95: proposed line for the admin feature list, worst shape at 60k features',
          device: 'server',
        }),
        Number(worst.toFixed(1)),
      ),
    );
  }, 600_000);
});
