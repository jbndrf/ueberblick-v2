import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planRedaction, type FeatureId, type RedactPair } from '@ueberblick/core';
import { openProjectDb } from '../db/open';
import type { Db } from '../db/driver';
import { createErasure } from './index';
import { createPrefsStore } from '../prefs';

const NOW = '2026-09-30T10:00:00.000Z';
const OTHER = 'species';

function open(): Db {
  return openProjectDb(':memory:', 'p');
}

function seedRun(db: Db, id: string, actor: string, input: unknown): void {
  db.prepare(
    `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
     VALUES (?, ?, 'participant', 'melden', 1, ?, ?, 'accepted')`,
  ).run(id, actor, JSON.stringify(input), NOW);
}

let seq = 0;
function seedObs(db: Db, runId: string, feature: string, property: string, result: unknown): number {
  const s = ++seq;
  db.prepare(
    'INSERT INTO observations (seq, run_id, feature_id, property, result) VALUES (?, ?, ?, ?, ?)',
  ).run(s, runId, feature, property, JSON.stringify(result));
  return s;
}

const all = (db: Db, sql: string): unknown[] => db.prepare(sql).all();
const dump = (db: Db): string =>
  JSON.stringify([
    all(db, 'SELECT * FROM observations'),
    all(db, 'SELECT id, input, result FROM runs'),
    all(db, 'SELECT * FROM blobs'),
  ]);

/** Runs the erasure the way the follow-up wires it: plan, append the nulls in the erasure run, then execute. */
function erase(db: Db, subject: string, pairs: readonly RedactPair[], run = 'erasure-1') {
  const plan = planRedaction({ pairs });
  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM runs WHERE id = ?').get(run)) seedRun(db, run, 'admin', { subject });
    for (const o of plan.observations) seedObs(db, run, o.featureId, o.property, o.result);
    return createErasure(db).erase({ subject, purge: plan.purge, erasureRun: run, at: NOW });
  });
}

describe('erasure triggers (migration 6)', () => {
  it('refuse any UPDATE or DELETE on observations and any UPDATE of runs.input without the guard', () => {
    const db = open();
    seedRun(db, 'r1', 'a', { phone: '123' });
    seedObs(db, 'r1', 'f1', 'phone', '123');
    expect(() => db.exec("UPDATE observations SET result = 'null'")).toThrow(/append-only/);
    expect(() => db.exec("UPDATE observations SET property = 'x'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM observations')).toThrow(/append-only/);
    expect(() => db.exec("UPDATE runs SET input = 'null'")).toThrow(/runs.input/);
    expect(() => db.exec("UPDATE runs SET task = 'x'")).not.toThrow();
  });

  it('with the guard open still allow only blanking, never a new value or a delete', () => {
    const db = open();
    seedRun(db, 'r1', 'a', { phone: '123' });
    seedObs(db, 'r1', 'f1', 'phone', '123');
    db.exec('UPDATE erasure_guard SET open = 1');
    expect(() => db.exec('UPDATE observations SET result = \'"other"\'')).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM observations')).toThrow(/append-only/);
    expect(() => db.exec('UPDATE runs SET input = \'{"x":1}\'')).toThrow(/runs.input/);
    expect(() => db.exec("UPDATE observations SET result = 'null'")).not.toThrow();
    expect(() => db.exec("UPDATE runs SET input = 'null'")).not.toThrow();
  });

  it('the executor closes the guard again, also when the surrounding transaction rolls back', () => {
    const db = open();
    seedRun(db, 'e', 'admin', {});
    seedObs(db, 'e', 'f1', 'phone', '1');
    expect(() =>
      db.transaction(() => {
        createErasure(db).erase({
          subject: 's',
          purge: [{ featureId: 'f1' as FeatureId, property: 'phone' }],
          erasureRun: 'other',
          at: NOW,
        });
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(db.prepare('SELECT open FROM erasure_guard').get()).toEqual({ open: 0 });
    expect(db.prepare('SELECT result FROM observations').get()).toEqual({ result: '"1"' });
    expect(all(db, 'SELECT * FROM erasure_subjects')).toEqual([]);
    expect(() => db.exec("UPDATE observations SET result = 'null'")).toThrow(/append-only/);
  });
});

describe('erasure_runs (migration 8)', () => {
  const pairs = [{ featureId: 'f1' as FeatureId, property: 'phone' }];
  const seedPhone = (db: Db): void => {
    seedRun(db, 'r1', 'anna', { phone: '111' });
    seedObs(db, 'r1', 'f1', 'phone', '111');
  };

  it('erase records the erasure run with its subject and time', () => {
    const db = open();
    seedPhone(db);
    erase(db, 'anna', pairs);
    expect(all(db, 'SELECT run_id, subject, erased_at FROM erasure_runs')).toEqual([
      { run_id: 'erasure-1', subject: 'anna', erased_at: NOW },
    ]);
  });

  it('is written in the erase transaction: an erase that fails leaves no row', () => {
    const db = open();
    seedRun(db, 'r1', 'anna', {});
    // A stored result that is not JSON makes the purge throw after the erasure run was recorded.
    db.prepare(
      "INSERT INTO observations (seq, run_id, feature_id, property, result) VALUES (1, 'r1', 'f1', 'phone', 'not json')",
    ).run();
    expect(() =>
      createErasure(db).erase({ subject: 'anna', purge: pairs, erasureRun: 'erasure-1', at: NOW }),
    ).toThrow();
    expect(all(db, 'SELECT * FROM erasure_runs')).toEqual([]);
    expect(all(db, 'SELECT * FROM erasure_subjects')).toEqual([]);
  });

  it.each([
    ['anna', 'bob'],
    ['bob', 'anna'],
  ])('one run erasing two subjects (%s then %s) records both, with the new time', (first, second) => {
    const db = open();
    seedPhone(db);
    db.exec("INSERT INTO erasure_subjects VALUES ('bob', '2026-01-01T00:00:00.000Z')");
    // The second call finds every pair already blanked, and must still refresh its subject row.
    erase(db, first, pairs);
    erase(db, second, pairs);
    expect(all(db, 'SELECT subject, erased_at FROM erasure_subjects ORDER BY subject')).toEqual([
      { subject: 'anna', erased_at: NOW },
      { subject: 'bob', erased_at: NOW },
    ]);
    expect(all(db, 'SELECT run_id, subject FROM erasure_runs ORDER BY subject')).toEqual([
      { run_id: 'erasure-1', subject: 'anna' },
      { run_id: 'erasure-1', subject: 'bob' },
    ]);
  });

  it('a repeated erase of the same run keeps one row', () => {
    const db = open();
    seedPhone(db);
    erase(db, 'anna', pairs);
    erase(db, 'anna', pairs);
    expect(all(db, 'SELECT run_id FROM erasure_runs')).toHaveLength(1);
  });
});

describe('createErasure', () => {
  it('blanks superseded values and the runs.input copy, keeps other values, records the subject', () => {
    const db = open();
    seedRun(db, 'r1', 'anna', { phone: '111', species: 'oak' });
    seedRun(db, 'r2', 'anna', { phone: '222' });
    seedObs(db, 'r1', 'f1', 'phone', '111');
    seedObs(db, 'r1', 'f1', OTHER, 'oak');
    seedObs(db, 'r2', 'f1', 'phone', '222');
    const r = erase(db, 'anna', [{ featureId: 'f1' as FeatureId, property: 'phone' }]);
    expect(r).toMatchObject({ purged: 2, scrubbedRuns: 2 });
    expect(dump(db)).not.toMatch(/111|222/);
    expect(all(db, "SELECT result FROM observations WHERE property = 'species'")).toEqual([
      { result: '"oak"' },
    ]);
    expect(all(db, 'SELECT subject, erased_at FROM erasure_subjects')).toEqual([
      { subject: 'anna', erased_at: NOW },
    ]);
    // The current value is the appended null: the highest seq of the pair is JSON null.
    expect(
      db.prepare("SELECT result FROM observations WHERE property = 'phone' ORDER BY seq DESC").get(),
    ).toEqual({ result: 'null' });
    // the erasure run's own input (the subject id) stays
    expect(db.prepare("SELECT input FROM runs WHERE id = 'erasure-1'").get()).toEqual({
      input: '{"subject":"anna"}',
    });
  });

  it('emits a redaction tombstone per affected pair and a blob tombstone for an unreferenced blob', () => {
    const db = open();
    const sha = 'a'.repeat(64);
    const shared = 'b'.repeat(64);
    db.exec(
      `INSERT INTO blobs VALUES ('${sha}','image/png',10,'${NOW}'), ('${shared}','image/png',10,'${NOW}')`,
    );
    seedRun(db, 'r1', 'anna', {});
    seedRun(db, 'r2', 'bob', {});
    seedObs(db, 'r1', 'f1', 'photo', { sha256: sha, name: 'a.png', mime: 'image/png' });
    seedObs(db, 'r1', 'f1', 'photo', { sha256: shared, name: 'c.png', mime: 'image/png' });
    seedObs(db, 'r2', 'f2', 'photo', { sha256: shared, name: 'c.png', mime: 'image/png' });
    const before = (db.prepare('SELECT max(seq) AS s FROM observations').get() as { s: number }).s;
    const r = erase(db, 'anna', [{ featureId: 'f1' as FeatureId, property: 'photo' }]);
    expect(r.orphanedBlobs).toEqual([sha]);
    expect(all(db, 'SELECT sha256 FROM blobs')).toEqual([{ sha256: shared }]);
    const t = all(db, 'SELECT seq, kind, id FROM tombstones ORDER BY seq') as {
      seq: number;
      kind: string;
      id: string;
    }[];
    expect(t.map((x) => [x.kind, x.id])).toEqual([
      ['redaction', 'f1#photo'],
      ['blob', sha],
    ]);
    expect(t.every((x) => x.seq > before + 1)).toBe(true);
  });

  it('is idempotent: erasing twice changes nothing more', () => {
    const db = open();
    seedRun(db, 'r1', 'anna', { phone: '111' });
    seedObs(db, 'r1', 'f1', 'phone', '111');
    const pairs = [{ featureId: 'f1' as FeatureId, property: 'phone' }];
    erase(db, 'anna', pairs);
    const once = dump(db) + JSON.stringify(all(db, 'SELECT * FROM tombstones'));
    const again = createErasure(db).erase({
      subject: 'anna',
      purge: pairs,
      erasureRun: 'erasure-1',
      at: '2027-01-01T00:00:00.000Z',
    });
    expect(again).toMatchObject({ purged: 0, scrubbedRuns: 0, tombstones: 0, orphanedBlobs: [] });
    expect(dump(db) + JSON.stringify(all(db, 'SELECT * FROM tombstones'))).toBe(once);
    // Only the subject's erasure time moves (always upserted, so a restore never skips it).
    expect(all(db, 'SELECT erased_at FROM erasure_subjects')).toEqual([
      { erased_at: '2027-01-01T00:00:00.000Z' },
    ]);
  });

  it('turns secure_delete on and the schema has runs(actor) and plain subject ids', () => {
    const db = open();
    seedRun(db, 'e', 'admin', {});
    createErasure(db).erase({ subject: 'x', purge: [], erasureRun: 'e', at: NOW });
    expect(db.prepare('PRAGMA secure_delete').get()).toEqual({ secure_delete: 1 });
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'runs_by_actor'").get() as {
      sql: string;
    };
    expect(idx.sql).toMatch(/runs \(actor\)/);
    expect(all(db, 'SELECT subject FROM erasure_subjects')).toEqual([{ subject: 'x' }]);
  });

  it('property: no personal value of the subject survives anywhere, other values are untouched', () => {
    const value = fc.string({ minLength: 6, maxLength: 12 }).map((s) => `v-${s.replace(/[^a-z0-9]/gi, 'x')}`);
    const log = fc.array(
      fc.record({
        actor: fc.constantFrom('anna', 'bob'),
        feature: fc.constantFrom('f1', 'f2', 'f3'),
        property: fc.constantFrom('phone', 'note', 'species'),
      }),
      { minLength: 1, maxLength: 25 },
    );
    fc.assert(
      fc.property(log, fc.uniqueArray(value, { minLength: 25, maxLength: 25 }), (entries, values) => {
        const db = open();
        const personal = new Set(['phone', 'note']);
        const mine = new Map<string, RedactPair>();
        const kept: string[] = [];
        entries.forEach((e, i) => {
          const v = values[i] as string;
          seedRun(db, `r${i}`, e.actor, { [e.property]: v });
          seedObs(db, `r${i}`, e.feature, e.property, v);
          if (e.actor === 'anna' && personal.has(e.property))
            mine.set(`${e.feature}#${e.property}`, {
              featureId: e.feature as FeatureId,
              property: e.property,
            });
        });
        // every observation of a purged pair is erased (also another actor's write of the same pair)
        const purgedPairs = new Set(mine.keys());
        entries.forEach((e, i) => {
          if (!purgedPairs.has(`${e.feature}#${e.property}`)) kept.push(values[i] as string);
        });
        erase(db, 'anna', [...mine.values()]);
        const rest = dump(db);
        entries.forEach((e, i) => {
          const gone = purgedPairs.has(`${e.feature}#${e.property}`);
          const v = values[i] as string;
          expect(rest.includes(`"${v}"`) || rest.includes(`\\"${v}\\"`)).toBe(!gone);
        });
        expect(kept.every((v) => rest.includes(v))).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});
// WP-612: the personal preference row is personal data, so the erasure deletes it with the rest.
describe('erasure and the prefs row (WP-612)', () => {
  const addParticipant = (db: Db, id: string): void => {
    db.prepare('INSERT INTO participants (id, roles) VALUES (?, ?)').run(id, '[]');
  };

  it('erasing a participant deletes their prefs row, other participants keep theirs', () => {
    const db = open();
    addParticipant(db, 'anna');
    addParticipant(db, 'bernd');
    const prefs = createPrefsStore(db, { now: () => NOW });
    prefs.patch('anna', [{ path: 'ui.theme', value: 'dark', at: NOW }]);
    prefs.patch('bernd', [{ path: 'tools.chat', value: true, at: NOW }]);
    erase(db, 'anna', []);
    expect(prefs.get('anna')).toEqual({});
    expect(prefs.get('bernd')).toEqual({ 'tools.chat': { value: true, at: NOW } });
    expect(all(db, 'SELECT participant_id FROM prefs')).toEqual([{ participant_id: 'bernd' }]);
  });

  it('a feature-subject erasure blanks the feature but leaves every prefs row in place', () => {
    const db = open();
    addParticipant(db, 'anna');
    const prefs = createPrefsStore(db, { now: () => NOW });
    prefs.patch('anna', [{ path: 'ui.theme', value: 'dark', at: NOW }]);
    seedRun(db, 'r1', 'anna', { phone: '111' });
    seedObs(db, 'r1', 'f1', 'phone', '111');
    erase(db, 'f1', [{ featureId: 'f1' as FeatureId, property: 'phone' }]);
    expect(dump(db)).not.toMatch(/111/);
    expect(prefs.get('anna')).toEqual({ 'ui.theme': { value: 'dark', at: NOW } });
  });
});
