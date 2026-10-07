import { describe, expect, it } from 'vitest';
import { planRedaction, SYNC_PROTOCOL_VERSION, type FeatureId, type RunId } from '@ueberblick/core';
import type { Db, Stmt } from '../db/driver';
import { openProjectDb } from '../db/open';
import { createLedger } from '../store/run/ledger';
import { anna, syncSetup, tree, vera } from '../sync/testkit';
import { createErasure } from './index';

const NOW = '2026-09-30T10:00:00.000Z';
const PAIR = [{ featureId: tree(1), property: 'intern_notiz' }];

/** A subject run with a stored ledger result, as the run transaction writes it. */
function subjectRun(
  db: Db,
  id: string,
  from: number,
  values: readonly [string, unknown][],
  input: unknown,
): void {
  db.prepare(
    `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, seq, result)
     VALUES (?, 'anna', 'participant', 'melden', 1, ?, ?, 'accepted', ?, ?)`,
  ).run(
    id,
    JSON.stringify(input),
    NOW,
    from + values.length - 1,
    JSON.stringify({ seq: { from, to: from + values.length - 1 } }),
  );
  values.forEach(([property, result], i) =>
    db
      .prepare('INSERT INTO observations (seq, run_id, feature_id, property, result) VALUES (?, ?, ?, ?, ?)')
      .run(from + i, id, tree(1), property, JSON.stringify(result)),
  );
}

describe('erasure end to end over the ledger and the sync read', () => {
  it('Ledger.find still answers for a run that wrote a purged value, now with null results', () => {
    const ctx = syncSetup();
    ctx.seed([{ id: tree(1), type: 'baum', properties: { zustaendig: 'anna', stage: 'erfasst' } }]);
    const from = ctx.service.head() + 1;
    subjectRun(ctx.db, 'r-anna', from, [['intern_notiz', 'old-secret']], { intern_notiz: 'old-secret' });
    const before = createLedger(ctx.db).find('r-anna' as RunId);
    expect(before?.outcome === 'accepted' && before.observations[0]?.result).toBe('old-secret');

    const plan = planRedaction({ pairs: PAIR });
    ctx.change(tree(1), { intern_notiz: null });
    const nullRun = ctx.db
      .prepare<{ run_id: string }>('SELECT run_id FROM observations ORDER BY seq DESC')
      .get();
    createErasure(ctx.db).erase({
      subject: 'anna',
      purge: plan.purge,
      erasureRun: nullRun?.run_id ?? '',
      at: NOW,
    });

    const after = createLedger(ctx.db).find('r-anna' as RunId);
    expect(after?.outcome).toBe('accepted');
    if (after?.outcome !== 'accepted') return;
    expect(after.observations.map((o) => o.result)).toEqual([null]);
  });

  it('a sync page carries the null observations and the redaction tombstone and no old value', () => {
    const ctx = syncSetup();
    ctx.seed([
      {
        id: tree(1),
        type: 'baum',
        properties: { zustaendig: 'anna', stage: 'erfasst', intern_notiz: 'first-secret' },
      },
    ]);
    const from = ctx.service.head() + 1;
    subjectRun(ctx.db, 'r-anna', from, [['intern_notiz', 'second-secret']], {
      intern_notiz: 'second-secret',
    });
    const since = ctx.service.head();

    const plan = planRedaction({ pairs: PAIR });
    ctx.change(tree(1), { intern_notiz: null });
    const nullRun = ctx.db
      .prepare<{ run_id: string }>('SELECT run_id FROM observations ORDER BY seq DESC')
      .get();
    createErasure(ctx.db).erase({
      subject: 'anna',
      purge: plan.purge,
      erasureRun: nullRun?.run_id ?? '',
      at: NOW,
    });

    const v = SYNC_PROTOCOL_VERSION;
    const snapshot = ctx.service.page(vera, { since: 0, scope: '', v });
    const delta = ctx.service.page(vera, { since, scope: snapshot.header.scopeFingerprint, v });
    for (const page of [snapshot, delta])
      expect(JSON.stringify(page)).not.toMatch(/first-secret|second-secret/);
    const notes = snapshot.observations.filter((o) => o.property === 'intern_notiz');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((o) => o.result === null)).toBe(true);
    expect(delta.tombstones.map((t) => [t.kind, t.id])).toContainEqual([
      'redaction',
      `${tree(1)}#intern_notiz`,
    ]);
    expect(
      ctx.service
        .page(anna, { since: 0, scope: '', v })
        .observations.every((o) => o.result === null || o.property !== 'intern_notiz'),
    ).toBe(true);
  });
});

describe('guard on exception', () => {
  it('closes the guard and leaves the data unchanged when the blanking statement throws', () => {
    const db = openProjectDb(':memory:', 'p');
    subjectRun(db, 'r1', 1, [['phone', '111']], { phone: '111' });
    const wrapped: Db = {
      ...db,
      prepare: <Row>(sql: string): Stmt<Row> => {
        const s = db.prepare<Row>(sql);
        return sql.startsWith('UPDATE observations SET result')
          ? {
              ...s,
              run: () => {
                throw new Error('disk full');
              },
            }
          : s;
      },
    };
    const erase = (): unknown =>
      createErasure(wrapped).erase({
        subject: 'anna',
        purge: [{ featureId: tree(1) as FeatureId, property: 'phone' }],
        erasureRun: 'other',
        at: NOW,
      });
    expect(erase).toThrow('disk full');
    expect(db.prepare('SELECT open FROM erasure_guard').get()).toEqual({ open: 0 });
    expect(db.prepare('SELECT result FROM observations').get()).toEqual({ result: '"111"' });
    expect(db.prepare('SELECT input FROM runs').get()).toEqual({ input: '{"phone":"111"}' });
    expect(db.prepare('SELECT count(*) AS n FROM erasure_subjects').get()).toEqual({ n: 0 });
    expect(() => db.exec("UPDATE observations SET result = 'null'")).toThrow(/append-only/);
  });
});

describe('mixed run', () => {
  it('blanks the whole runs.input but the non-personal observation of the run keeps its value', () => {
    const db = openProjectDb(':memory:', 'p');
    subjectRun(
      db,
      'r1',
      1,
      [
        ['phone', '111'],
        ['species', 'oak'],
      ],
      { phone: '111', species: 'oak' },
    );
    createErasure(db).erase({
      subject: 'anna',
      purge: [{ featureId: tree(1) as FeatureId, property: 'phone' }],
      erasureRun: 'other',
      at: NOW,
    });
    expect(db.prepare('SELECT input FROM runs WHERE id = ?').get('r1')).toEqual({ input: 'null' });
    expect(db.prepare("SELECT result FROM observations WHERE property = 'species'").get()).toEqual({
      result: '"oak"',
    });
    expect(db.prepare("SELECT result FROM observations WHERE property = 'phone'").get()).toEqual({
      result: 'null',
    });
  });
});
