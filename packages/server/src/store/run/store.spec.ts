// WP-104: one test (or more) per acceptance box.
import { describe, expect, it } from 'vitest';
import type { FeatureId, Json } from '@ueberblick/core';
import { ConfigVersionGone, type BatchResult, type SubmitResult } from './contract';
import { IDS, admin, anna, bernd, dumpAll, fid, headSeq, seedMusterstadt, setup, vera } from './testkit';

const accepted = (r: SubmitResult) => {
  if (r.outcome !== 'accepted') throw new Error(`refused: ${r.refusal.code} ${r.refusal.message}`);
  return r;
};
const refusedBatch = (r: BatchResult) => {
  if (r.outcome !== 'refused') throw new Error('expected a refused batch');
  return r;
};
const count = (db: ReturnType<typeof setup>['db'], table: string): number =>
  (db.prepare<{ n: number }>(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

const kontrolle = (befund: string, vitalitaet = 'v2'): Record<string, Json> => ({ vitalitaet, befund });
const tree = (x: number, y: number): Record<string, Json> => ({
  vitalitaet: 'v2',
  geometrie: { type: 'Point', coordinates: [x, y] },
});

describe('ledger: idempotency', () => {
  it('the same run twice returns the identical result and writes nothing the second time', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, kontrolle('Kronenpflege'), IDS.t_in);
    const first = accepted(c.store.submit(run));
    const before = dumpAll(c.db);
    const second = c.store.submit(run);
    expect(second).toEqual(first);
    expect(dumpAll(c.db)).toBe(before);
  });

  it('a changed input under the same id is refused id_taken and writes nothing (WP-754; the golden scenario covers the exact replay only)', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, kontrolle('Erstbefund'), IDS.t_in);
    const first = c.store.submit(run);
    const again = c.store.submit({ ...run, input: kontrolle('Manipuliert', 'v4') });
    expect(first.outcome).toBe('accepted');
    expect(again.outcome).toBe('refused');
    if (again.outcome === 'refused') expect(again.refusal.code).toBe('id_taken');
    expect(count(c.db, 'runs')).toBe(2); // the seed run and the one run
    expect(c.store.facts.feature(IDS.t_in)?.properties['befund']).toBe('Erstbefund');
  });

  it('a refused run is idempotent too, message included', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'unauffällig' }, IDS.t_in);
    const first = c.store.submit(run);
    expect(first.outcome).toBe('refused');
    const before = dumpAll(c.db);
    expect(c.store.submit(run)).toEqual(first);
    expect(dumpAll(c.db)).toBe(before);
    if (first.outcome === 'refused') expect(first.refusal.message).toContain('Befund muss sich ändern');
  });

  it('the result of an accepted run lists its observations and a contiguous seq range', () => {
    const c = setup();
    seedMusterstadt(c);
    const head = headSeq(c.db);
    const r = accepted(c.store.submit(c.run('kontrolle', anna, kontrolle('x'), IDS.t_in)));
    expect(r.seq.from).toBe(head + 1);
    expect(r.observations.map((o) => o.seq)).toEqual(
      Array.from({ length: r.seq.to - r.seq.from + 1 }, (_, i) => r.seq.from + i),
    );
    expect(r.observations.map((o) => `${o.featureId}.${o.property}`)).toContain(
      `${IDS.park}.letzte_kontrolle`,
    );
    expect(headSeq(c.db)).toBe(r.seq.to);
  });
});

describe('refusals', () => {
  it('a refused run writes the run row (rejected) and nothing else', () => {
    const c = setup();
    seedMusterstadt(c);
    const tables = ['observations', 'features', 'edges', 'feature_bbox', 'tombstones', 'outbox', 'timers'];
    const before = tables.map((t) => count(c.db, t));
    const head = headSeq(c.db);
    const run = c.run('kontrolle', bernd, kontrolle('x'), IDS.t_in);
    const r = c.store.submit(run);
    expect(r.outcome).toBe('refused');
    const row = c.db.prepare<Record<string, unknown>>('SELECT * FROM runs WHERE id = ?').get(run.id);
    expect(row).toMatchObject({
      outcome: 'rejected',
      refusal_code: 'not_permitted',
      seq: null,
      caused_by: null,
      actor: 'bernd',
      actor_kind: 'participant',
    });
    expect(tables.map((t) => count(c.db, t))).toEqual(before);
    expect(headSeq(c.db)).toBe(head);
  });

  it('a config version that is gone throws before anything is written', () => {
    const c = setup();
    seedMusterstadt(c);
    const before = dumpAll(c.db);
    const run = c.run('kontrolle', anna, kontrolle('x'), IDS.t_in, { configVersion: 7 });
    expect(() => c.store.submit(run)).toThrow(ConfigVersionGone);
    expect(dumpAll(c.db)).toBe(before);
  });
});

describe('batches (H2)', () => {
  const erfasse = (c: ReturnType<typeof setup>, n: number, bad?: number) =>
    Array.from({ length: n }, (_, i) =>
      c.run('erfassen', vera, i === bad ? { vitalitaet: 'v1' } : tree(7.1 + i * 0.0005, 50.735)),
    );

  it('is all-or-nothing: one refusal refuses the batch with the index and the refusal', () => {
    const c = setup();
    seedMusterstadt(c);
    const before = ['observations', 'features', 'edges', 'feature_bbox', 'tombstones'].map((t) =>
      count(c.db, t),
    );
    const head = headSeq(c.db);
    const runs = erfasse(c, 5, 3);
    const r = refusedBatch(c.store.submitBatch(runs));
    expect(r.index).toBe(3);
    expect(r.runId).toBe(runs[3]?.id);
    expect(r.refusal.code).toBe('geometry_required');
    expect(
      ['observations', 'features', 'edges', 'feature_bbox', 'tombstones'].map((t) => count(c.db, t)),
    ).toEqual(before);
    expect(headSeq(c.db)).toBe(head);
    const rows = c.db
      .prepare<{ id: string; outcome: string; refusal_code: string }>(
        `SELECT id, outcome, refusal_code FROM runs WHERE id IN (${runs.map(() => '?').join(',')}) ORDER BY id`,
      )
      .all(...runs.map((x) => x.id));
    expect(rows.every((x) => x.outcome === 'rejected')).toBe(true);
    expect(rows.filter((x) => x.refusal_code === 'batch_failed')).toHaveLength(4);
    // a retry answers the same way and writes nothing
    const dump = dumpAll(c.db);
    expect(c.store.submitBatch(runs)).toEqual(r);
    expect(dumpAll(c.db)).toBe(dump);
  });

  it('30 new features: one transaction, one contiguous seq range, results in order', () => {
    const c = setup();
    seedMusterstadt(c);
    const head = headSeq(c.db);
    const runs = erfasse(c, 30);
    const r = c.store.submitBatch(runs);
    if (r.outcome !== 'accepted') throw new Error(r.refusal.message);
    expect(r.results.map((x) => x.runId)).toEqual(runs.map((x) => x.id));
    expect(r.seq.from).toBe(head + 1);
    const seqs = c.db
      .prepare<{ seq: number }>('SELECT seq FROM observations WHERE seq > ? ORDER BY seq')
      .all(head);
    expect(seqs.map((x) => x.seq)).toEqual(Array.from({ length: r.seq.to - head }, (_, i) => head + 1 + i));
    for (let i = 1; i < r.results.length; i++)
      expect((r.results[i] as { seq: { from: number } }).seq.from).toBe(
        (r.results[i - 1] as { seq: { to: number } }).seq.to + 1,
      );
    expect(count(c.db, 'features')).toBe(5 + 30);
    // a replay returns the same batch result and writes nothing
    const dump = dumpAll(c.db);
    expect(c.store.submitBatch(runs)).toEqual(r);
    expect(dumpAll(c.db)).toBe(dump);
  });

  it('later runs of a batch see the earlier ones (plan overlay), and a duplicate id is refused', () => {
    const c = setup();
    seedMusterstadt(c);
    const a = c.run('erfassen', vera, tree(7.1005, 50.735));
    const dup = c.run('erfassen', vera, tree(7.1006, 50.735), undefined, { id: a.id });
    const before = dumpAll(c.db);
    const r = refusedBatch(c.store.submitBatch([a, dup]));
    expect(r.index).toBe(1);
    expect(r.refusal.code).toBe('invalid_input');
    expect(dumpAll(c.db)).toBe(before); // a malformed request writes nothing
  });

  it('runs of one batch must share a config version', () => {
    const c = setup();
    seedMusterstadt(c);
    const r = refusedBatch(
      c.store.submitBatch([
        c.run('erfassen', vera, tree(7.1, 50.735)),
        c.run('erfassen', vera, tree(7.1, 50.735), undefined, { configVersion: 2 }),
      ]),
    );
    expect(r.index).toBe(1);
    expect(r.refusal.code).toBe('invalid_input');
  });
});

describe('rules in the same transaction', () => {
  it('a rule run is stored with caused_by, inside the submitted run seq range', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, kontrolle('Pilzbefall', 'v3'), IDS.t_in);
    const r = accepted(c.store.submit(run));
    const rows = c.db
      .prepare<{
        id: string;
        task: string;
        actor_kind: string;
        caused_by: string | null;
        seq: number | null;
      }>(
        'SELECT id, task, actor_kind, caused_by, seq FROM runs WHERE id = ? OR caused_by IS NOT NULL ORDER BY seq',
      )
      .all(run.id);
    expect(rows.map((x) => [x.task, x.actor_kind, x.caused_by])).toEqual([
      ['kontrolle', 'participant', null],
      ['massnahme_anlegen', 'system', run.id],
    ]);
    const created = r.observations.find((o) => o.property === '$type' && o.result === 'massnahme');
    expect(created).toBeDefined();
    expect(rows[1]?.seq).toBe(r.seq.to);
    // the created feature exists after the same commit, with its reference edge
    const m = created?.featureId as FeatureId;
    expect(c.store.facts.feature(m)?.type).toBe('massnahme');
    expect(c.store.facts.edgesFrom(m, 'baum' as never).map((e) => e.to)).toEqual([IDS.t_in]);
    expect(rows[1]?.id).toBeDefined();
  });

  it('a chain deeper than the limit refuses the submitted run; nothing but the ledger row remains', async () => {
    const { deepChain } = await import('./deep-chain.testkit');
    const c = setup({ config: deepChain() });
    const before = dumpAll(c.db);
    const run = c.run('start', admin, { n: 0 });
    const r = c.store.submit(run);
    expect(r.outcome).toBe('refused');
    if (r.outcome === 'refused') expect(r.refusal.code).toBe('depth_exceeded');
    const after = JSON.parse(dumpAll(c.db)) as {
      runs: unknown[];
      observations: unknown[];
      features: unknown[];
    };
    expect(after.runs).toHaveLength(1);
    expect(after.observations).toEqual(JSON.parse(before).observations);
    expect(after.features).toEqual(JSON.parse(before).features);
  });
});

describe('hooks (outbox, timers)', () => {
  it('run inside the transaction after the fold and see the batch', () => {
    const seen: { runs: number; features: string[]; status: unknown }[] = [];
    const c = setup({
      hooks: [
        (ctx) => {
          seen.push({
            runs: ctx.runs.length,
            features: ctx.features.map((f) => f.id),
            status: ctx.db.prepare('SELECT properties FROM features WHERE id = ?').get(IDS.t_in),
          });
          ctx.db
            .prepare("INSERT INTO outbox (run_id, kind, payload) VALUES (?, 'webhook', '{}')")
            .run(ctx.runs[0]?.run.id ?? '');
        },
      ],
    });
    seedMusterstadt(c);
    const seeded = count(c.db, 'outbox');
    accepted(c.store.submit(c.run('kontrolle', anna, kontrolle('x', 'v3'), IDS.t_in)));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.runs).toBe(2); // the run and the rule run
    expect(seen[0]?.features).toContain(IDS.t_in);
    expect(seen[0]?.status).toBeDefined();
    expect(count(c.db, 'outbox')).toBe(seeded + 1);
  });

  it('a throwing hook rolls the whole run back', () => {
    const c = setup({
      hooks: [
        () => {
          throw new Error('outbox down');
        },
      ],
    });
    const before = dumpAll(c.db);
    expect(() => c.store.submit(c.run('erfassen', vera, tree(7.1, 50.735)))).toThrow(/hook 'unnamed' failed/);
    expect(dumpAll(c.db)).toBe(before);
  });
});

describe('edge tombstones and derived edges', () => {
  it('a removed edge leaves an edge tombstone with a fresh seq; the head covers it', () => {
    const c = setup();
    seedMusterstadt(c);
    const edge = { from: IDS.t_in, relation: 'flaeche', to: IDS.park };
    expect(c.store.facts.edgesFrom(IDS.t_in, 'flaeche' as never).map((e) => e.to)).toEqual([IDS.park]);
    const r = accepted(
      c.store.submit(
        c.run('verschieben', vera, { geometrie: { type: 'Point', coordinates: [7.3, 50.9] } }, IDS.t_in),
      ),
    );
    expect(c.store.facts.edgesFrom(IDS.t_in, 'flaeche' as never)).toEqual([]);
    const t = c.db
      .prepare<{ seq: number; kind: string; id: string }>('SELECT * FROM tombstones ORDER BY seq')
      .all();
    expect(t.map((x) => x.kind)).toEqual(['edge', 'edge']); // flaeche and randlage
    expect(t.map((x) => x.id)).toContain(`${edge.from}\u0000${edge.relation}\u0000${edge.to}`);
    expect(new Set(t.map((x) => x.seq)).size).toBe(t.length);
    expect(Math.min(...t.map((x) => x.seq))).toBeGreaterThan(r.seq.to);
    expect(headSeq(c.db)).toBe(Math.max(...t.map((x) => x.seq)));
    // the next run continues after the head, so seqs never collide
    const next = accepted(c.store.submit(c.run('befund_ergaenzen', anna, { befund: 'y' }, IDS.t_hole)));
    expect(next.seq.from).toBe(headSeq(c.db) - (next.seq.to - next.seq.from));
    expect(next.seq.from).toBeGreaterThan(Math.max(...t.map((x) => x.seq)));
  });

  it('a new tree inside the park gets its derived edges in the same commit', () => {
    const c = setup();
    seedMusterstadt(c);
    const r = accepted(c.store.submit(c.run('erfassen', vera, tree(7.1015, 50.7325))));
    const id = r.observations.find((o) => o.property === '$type')?.featureId as FeatureId;
    expect(c.store.facts.edgesFrom(id).map((e) => `${e.relation}>${e.to}`)).toEqual([
      `flaeche>${IDS.park}`,
      `randlage>${IDS.park}`,
    ]);
    expect(c.store.access(1)?.related(id, 'flaeche' as never)).toEqual([IDS.park]);
    expect(fid(1)).toBe(IDS.park);
  });
});
