/**
 * Budget (docs/12 line `admin-feature-history-p95`): the feature history (E-9) answers one page (50 runs with their
 * observations) in <= 100 ms p95 at a feature with 5k runs in a project with 60k runs. Server code, measured as called by
 * the handler (SQL, observation range read, JSON). Data: 60k run rows with two observations each (a tenth refused),
 * 5k of them about one feature, the rest about 200 others, written directly into a project database.
 * Run: npm test -- -c bench/vitest.config.ts bench/admin-features/history
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { golden, setup } from '../../packages/server/src/store/run/testkit';
import { writeDeps } from '../../packages/server/src/http/admin-features/testkit';
import { createAdminFeatureHandlers, type HistoryPage } from '../../packages/server/src/http/admin-features';

const RUNS = 60_000;
const TARGET_RUNS = 5_000;
const TARGET = 'target-feature';
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;

describe('bench: admin feature history', () => {
  it('first, middle and last page p95 at a feature with 5k runs in 60k runs', async () => {
    const ctx = setup({ config: golden('musterstadt-plain') });
    const { db } = ctx;
    const putRun = db.prepare(
      `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, refusal_code, seq, result, feature_id)
       VALUES (?, ?, 'participant', 'kontrolle', 1, '{}', ?, ?, ?, ?, ?, ?)`,
    );
    const putObs = db.prepare(
      'INSERT INTO observations (seq, run_id, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?, ?)',
    );
    let seq = 0;
    db.transaction(() => {
      db.prepare(
        `INSERT INTO features (id, type, config_version, properties, updated_seq, lifecycle) VALUES (?, 'baum', 1, '{}', 1, 'active')`,
      ).run(TARGET);
      for (let i = 0; i < RUNS; i++) {
        // every 12th run is about the target: 5k of 60k
        const feature = i % 12 === 0 && i / 12 < TARGET_RUNS ? TARGET : `f${i % 200}`;
        const refused = i % 10 === 7;
        const at = `2026-03-${String(1 + (i % 28)).padStart(2, '0')}T08:00:00.000Z`;
        if (refused) {
          putRun.run(
            `r${i}`,
            `user${i % 9}`,
            at,
            'rejected',
            'invalid_input',
            null,
            '{"refusal":{"code":"invalid_input","message":"x"}}',
            feature,
          );
          continue;
        }
        const from = seq + 1;
        putRun.run(
          `r${i}`,
          `user${i % 9}`,
          at,
          'accepted',
          null,
          from + 1,
          JSON.stringify({ seq: { from, to: from + 1 } }),
          feature,
        );
        putObs.run(++seq, `r${i}`, feature, 'befund', JSON.stringify(`b${i}`), at);
        putObs.run(++seq, `r${i}`, feature, 'vitalitaet', '"v2"', at);
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
    const ask = async (cursor: string | null): Promise<HistoryPage> => {
      const res = handlers.history({
        request: new Request(
          `http://x/api/admin/p/p/features/${TARGET}/history${cursor === null ? '' : `?cursor=${cursor}`}`,
        ),
        params: { project: 'p', feature: TARGET },
        principal,
      });
      if (res.status !== 200) throw new Error(String(res.status));
      return (await res.json()) as HistoryPage;
    };
    // Cursors: first page, the page in the middle and the last (walk once to find them).
    const cursors: (string | null)[] = [null];
    for (let page = await ask(null); page.next !== null; page = await ask(page.next)) cursors.push(page.next);
    const pick = [
      cursors[0] ?? null,
      cursors[Math.floor(cursors.length / 2)] ?? null,
      cursors[cursors.length - 1] ?? null,
    ];
    const shapes: [string, number[]][] = [];
    for (const [name, cursor] of [
      ['first page', pick[0]],
      ['middle page', pick[1]],
      ['last page', pick[2]],
    ] as const) {
      for (let i = 0; i < 3; i++) await ask(cursor ?? null);
      const xs: number[] = [];
      for (let i = 0; i < 40; i++) {
        const t = performance.now();
        await ask(cursor ?? null);
        xs.push(performance.now() - t);
      }
      shapes.push([name, xs]);
    }
    for (const [name, xs] of shapes)
      process.stderr.write(
        `admin feature history: ${name} p95 ${p95(xs).toFixed(1)} ms (${cursors.length} pages)\n`,
      );
    assertBudget(
      report(
        defineBudget({
          id: 'admin-feature-history-p95',
          limit: 100,
          unit: 'ms',
          derivedFrom:
            'admin-features-p95: proposed line for the feature history, worst page at 5k runs of one feature',
          device: 'server',
        }),
        Number(Math.max(...shapes.map(([, xs]) => p95(xs))).toFixed(1)),
      ),
    );
  }, 600_000);
});
