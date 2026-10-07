// WP-142.2 (A-021): erasure is an ordinary run of a `redact` task. The run transaction executes the purge.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';
import { createErasure, type Erasure, type ErasureResult } from '../../erasure';
import { createStore } from './index';
import type { Store, StoreDeps } from './contract';
import { expectDeclaredFieldsOnly } from './log.testkit';
import { NOW, dumpAll, type Ctx } from './testkit';
import { SHA, eraseRun, logsContain, mia, results, root, sabine, world } from './erasure.testkit';

const EMPTY: ErasureResult = { purged: 0, scrubbedRuns: 0, tombstones: 0, orphanedBlobs: [] };
const storeWith = (c: Ctx, over: Partial<StoreDeps>): Store => createStore(c.db, { ...c.deps, ...over });
const counting = (): { erasure: Erasure; calls: () => number } => {
  let n = 0;
  return { erasure: { erase: () => (n++, EMPTY) }, calls: () => n };
};
const failingAfterWork = (c: Ctx, msg: string): Erasure => ({
  erase: (i) => {
    createErasure(c.db).erase(i); // did its work, then fails
    throw new Error(msg);
  },
});

describe('an erasure run is logged like any run (WP-163)', () => {
  it('run.committed once, declared fields only, no personal value; a replay logs nothing', () => {
    const { c } = world();
    const run = eraseRun(c);
    c.store.submit(run);
    c.store.submit(run);
    const lines = c.logs.only('run.committed').filter((l) => l['runId'] === run.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ actor: 'root' });
    expectDeclaredFieldsOnly(c.logs.lines());
    expect(logsContain(c.logs.lines())).toBe(false);
  });

  it('the check sees a logged personal value, and never matches the digits of a timing', () => {
    const timing = { event: 'run.committed', level: 'info', t: 1, ms: 2.8723030000001017 };
    expect(logsContain([timing], ['030'])).toBe(false);
    expect(logsContain([{ ...timing, actor: '0151 123' }])).toBe(true);
    expect(logsContain([{ ...timing, note: 'tel 030 1' }], ['030 1'])).toBe(true);
  });
});

describe('a run of a redact task erases inside its transaction', () => {
  it('blanks the superseded results and the report run input, records the subject, closes the guard', () => {
    const { c, reportRun } = world();
    expect(c.store.submit(eraseRun(c)).outcome).toBe('accepted');
    expect(results(c, 'telefon')).toEqual(['null', 'null']);
    expect(results(c, 'foto')).toEqual(['null', 'null']);
    expect(c.db.prepare('SELECT input FROM runs WHERE id = ?').get(reportRun)).toEqual({ input: 'null' });
    expect(c.db.prepare('SELECT subject FROM erasure_subjects').all()).toEqual([{ subject: 'mia' }]);
    expect(c.db.prepare('SELECT open FROM erasure_guard').get()).toEqual({ open: 0 });
    expect(c.db.prepare('SELECT count(*) AS n FROM blobs').get()).toEqual({ n: 0 });
    expect(c.db.prepare("SELECT count(*) AS n FROM tombstones WHERE kind = 'blob'").get()).toEqual({ n: 1 });
  });

  it('keeps the erasure run own input, and other participants values', () => {
    const { c } = world();
    c.store.submit(c.run('melden', sabine, { kategorie: 'park', telefon: '030 1' }));
    const run = eraseRun(c);
    c.store.submit(run);
    expect(c.db.prepare('SELECT input FROM runs WHERE id = ?').get(run.id)).toEqual({
      input: '{"subject":"mia"}',
    });
    expect(results(c, 'telefon')).toEqual(['null', '"030 1"', 'null']);
  });

  it('secure_delete is on for the connection after an erasure', () => {
    const { c } = world();
    c.store.submit(eraseRun(c));
    expect(c.db.prepare('PRAGMA secure_delete').get()).toEqual({ secure_delete: 1 });
  });

  it('submitBatch erases alike, in the batch transaction', () => {
    const { c } = world();
    const r = c.store.submitBatch([eraseRun(c)]);
    expect(r.outcome).toBe('accepted');
    expect(results(c, 'telefon')).toEqual(['null', 'null']);
  });

  it('erase runs inside the transaction: it sees the run row and the appended null', () => {
    const { c } = world();
    const seen: unknown[] = [];
    storeWith(c, {
      erasure: {
        erase: (i) => {
          seen.push(c.db.prepare('SELECT count(*) AS n FROM runs WHERE id = ?').get(i.erasureRun));
          seen.push(results(c, 'telefon'));
          seen.push(i.subject);
          return EMPTY;
        },
      },
    }).submit(eraseRun(c));
    expect(seen).toEqual([{ n: 1 }, ['"0151 123"', 'null'], 'mia']);
  });

  it('a throwing erase rolls the whole run back, guard closed', () => {
    const { c } = world();
    const before = dumpAll(c.db);
    expect(() => storeWith(c, { erasure: failingAfterWork(c, 'disk full') }).submit(eraseRun(c))).toThrow(
      'disk full',
    );
    expect(dumpAll(c.db)).toBe(before);
    expect(c.db.prepare('SELECT open FROM erasure_guard').get()).toEqual({ open: 0 });
  });

  it('a repeated run id answers from the ledger, erases and writes nothing more', () => {
    const { c } = world();
    const k = counting();
    const run = eraseRun(c);
    const first = c.store.submit(run);
    const dump = dumpAll(c.db);
    expect(storeWith(c, { erasure: k.erasure }).submit(run)).toEqual(first);
    expect(k.calls()).toBe(0);
    expect(dumpAll(c.db)).toBe(dump);
  });

  it('an ordinary run never calls erase', () => {
    const { c } = world();
    const k = counting();
    storeWith(c, { erasure: k.erasure }).submit(c.run('melden', mia, { kategorie: 'x', telefon: '1' }));
    expect(k.calls()).toBe(0);
  });

  it('a redact run with nothing to purge does not call erase', () => {
    const { c } = world();
    const k = counting();
    const r = storeWith(c, { erasure: k.erasure }).submit(eraseRun(c, 'nobody'));
    expect(r.outcome).toBe('accepted');
    expect(k.calls()).toBe(0);
  });
});

describe('a run with two redact steps', () => {
  const OLD = '2020-01-01T00:00:00.000Z';
  // bob has nothing left to blank and an older erasure_subjects row: he must still get this run's erased_at.
  for (const order of [
    ['mia', 'bob'],
    ['bob', 'mia'],
  ] as const)
    it(`records both subjects with the new erased_at (${order.join(', ')})`, () => {
      const { c } = world();
      c.db.prepare('INSERT INTO erasure_subjects (subject, erased_at) VALUES (?, ?)').run('bob', OLD);
      c.db.prepare('INSERT INTO erasure_subjects (subject, erased_at) VALUES (?, ?)').run('mia', OLD);
      const r = c.store.submit(c.run('erase_two', root, { a: order[0], b: order[1] }));
      expect(r.outcome).toBe('accepted');
      const rows = c.db.prepare('SELECT subject, erased_at FROM erasure_subjects ORDER BY subject').all();
      expect(rows).toEqual([
        { subject: 'bob', erased_at: NOW },
        { subject: 'mia', erased_at: NOW },
      ]);
      expect(results(c, 'telefon')).toEqual(['null', 'null']);
    });

  for (const order of [
    ['mia', 'bob'],
    ['bob', 'mia'],
  ] as const)
    it(`each subject's erase call carries its own pairs, none of the other's (${order.join(', ')})`, () => {
      const { c } = world();
      const bob = { ...mia, id: 'bob' };
      const rb = c.store.submit(c.run('melden', bob, { kategorie: 'park', telefon: '030 9' }));
      const ownFeature = (who: string): string =>
        (
          c.db
            .prepare<{ feature_id: string }>(
              "SELECT o.feature_id FROM observations o JOIN runs r ON r.id = o.run_id WHERE r.actor = ? AND o.property = '$type'",
            )
            .get(who) as { feature_id: string }
        ).feature_id;
      expect(rb.outcome).toBe('accepted');
      const calls: { subject: string; features: string[] }[] = [];
      const real = createErasure(c.db);
      const spy: Erasure = {
        erase: (i) => {
          calls.push({ subject: i.subject, features: [...new Set(i.purge.map((p) => p.featureId))] });
          return real.erase(i);
        },
      };
      const run = c.run('erase_two', root, { a: order[0], b: order[1] });
      expect(storeWith(c, { erasure: spy }).submit(run).outcome).toBe('accepted');
      expect(calls).toEqual(order.map((subject) => ({ subject, features: [ownFeature(subject)] })));
      expect(results(c, 'telefon')).toEqual(['null', 'null', 'null', 'null']);
    });
});

describe('who may erase comes from the config roles', () => {
  it('a participant without the role is refused; nothing is erased', () => {
    const { c } = world();
    const k = counting();
    const r = storeWith(c, { erasure: k.erasure }).submit(eraseRun(c, 'mia', mia));
    expect(r).toMatchObject({ outcome: 'refused' });
    expect(k.calls()).toBe(0);
    expect(results(c, 'telefon')).toEqual(['"0151 123"']);
  });

  it('a case handler and an admin may run it', () => {
    const { c } = world();
    expect(c.store.submit(eraseRun(c, 'mia', sabine)).outcome).toBe('accepted');
    expect(c.store.submit(eraseRun(c, 'mia', root)).outcome).toBe('accepted');
  });
});

describe('orphaned blobs', () => {
  const observe = (c: Ctx, seen: unknown[]): Partial<StoreDeps> => ({
    onOrphanedBlobs: (ids) => {
      let inTransaction = true;
      try {
        c.db.exec('BEGIN'); // refused while a transaction is open
        c.db.exec('ROLLBACK');
        inTransaction = false;
      } catch {
        inTransaction = true;
      }
      seen.push({ ids, inTransaction, blobRow: c.db.prepare('SELECT * FROM blobs').get() });
    },
  });

  it('hands the orphaned ids over after commit, never inside the transaction', () => {
    const { c } = world();
    const seen: unknown[] = [];
    expect(storeWith(c, observe(c, seen)).submit(eraseRun(c)).outcome).toBe('accepted');
    expect(seen).toEqual([{ ids: [SHA], inTransaction: false, blobRow: undefined }]);
  });

  it('does not call it when the run rolls back', () => {
    const { c } = world();
    const seen: unknown[] = [];
    const s = storeWith(c, { ...observe(c, seen), erasure: failingAfterWork(c, 'late failure') });
    expect(() => s.submit(eraseRun(c))).toThrow('late failure');
    expect(seen).toEqual([]);
    expect(c.db.prepare('SELECT sha256 FROM blobs').all()).toEqual([{ sha256: SHA }]);
  });

  it('is not called again by a repeat', () => {
    const { c } = world();
    const seen: unknown[] = [];
    const s = storeWith(c, observe(c, seen));
    const run = eraseRun(c);
    s.submit(run);
    s.submit(run);
    expect(seen).toHaveLength(1);
  });
});

describe('there is no second way in (R3, R11)', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (f === 'node_modules' || f === '.svelte-kit' || isPlanted(p)) return [];
      if (statSync(p).isDirectory()) return sources(p);
      return /\.(ts|svelte)$/.test(f) ? [p] : [];
    });
  const roots = [
    new URL('../../', import.meta.url).pathname,
    new URL('../../../../../apps/web/src/', import.meta.url).pathname,
  ];
  const gone = ['submit' + 'Erasure', 'erasureHandlersFor', 'confirmation' + '_required'];

  it('Store.submitErasure, the admin erasure handler and its error code are gone', () => {
    const hits = roots
      .flatMap(sources)
      .filter((f) => !f.endsWith('store/run/erasure.spec.ts'))
      .filter((f) => gone.some((w) => readFileSync(f, 'utf8').includes(w)));
    expect(hits).toEqual([]);
  });

  it('the admin erasure route directory is gone', () => {
    const web = new URL('../../../../../apps/web/src/routes/api/admin/p/', import.meta.url).pathname;
    expect(sources(web).filter((f) => f.includes('/erasure/'))).toEqual([]);
  });
});
