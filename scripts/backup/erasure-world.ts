// Test world of the erasure replay (WP-536, reused by WP-943): a project with personal values in observations and a
// file value, a pre-erasure snapshot, the erasures on the live database and the journal exported from it.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, expect } from 'vitest';
import { serialize, type FeatureId, type Json } from '@ueberblick/core';
import { openSqlite, type Db } from '../../packages/server/src/db/driver';
import { openControlDb } from '../../packages/server/src/db/open';
import { build, setup, type Ctx } from '../../packages/server/src/store/run/testkit';
import { eraseRun, erasureTemplate, mia, root } from '../../packages/server/src/store/run/erasure.testkit';
import { exportJournal, type Journal } from './journal.mjs';
import { STAGING_SUFFIX } from './replay.mjs';

const dirs: string[] = [];
export const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ub-world-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

export const SECRET = 'Anna Muster 0151 Hauptstrasse 7';
export const NOTE = 'Bernd Beispiel Tel 0170';
export const SHA = 'c'.repeat(64);
const FILE: Json = [{ sha256: SHA, name: 'ausweis.jpg', mime: 'image/jpeg' }];
export const CLOCK = { now: () => '2026-10-01T09:00:00.000Z' };
const anna = { ...mia, id: 'anna' };
const bernd = { ...mia, id: 'bernd' };

export interface Seeded {
  readonly c: Ctx;
  /** anna: telefon and foto. bernd: telefon. */
  readonly pair: { featureId: FeatureId; property: string };
  readonly photo: { featureId: FeatureId; property: string };
  readonly note: { featureId: FeatureId; property: string };
}

/** A project with personal values in observations and a file value; the submitting runs keep the same values in their input. */
export function seed(): Seeded {
  const c = setup({ config: build(erasureTemplate()) });
  c.db
    .prepare(`UPDATE config_versions SET compiled = ? WHERE version = 1`)
    .run(JSON.stringify(serialize(c.config)));
  c.db
    .prepare('INSERT INTO blobs VALUES (?, ?, ?, ?)')
    .run(SHA, 'image/jpeg', 10, '2026-05-01T08:00:00.000Z');
  c.db.prepare('INSERT INTO blob_uploads VALUES (?, ?, ?, ?)').run(SHA, anna.id, anna.kind, 'x'); // anna uploaded it (WP-757)
  const report = (who: typeof anna, input: Record<string, Json>): FeatureId => {
    const r = c.store.submit(c.run('melden', who, input));
    if (r.outcome !== 'accepted') throw new Error(JSON.stringify(r));
    const [first] = r.observations;
    if (first === undefined) throw new Error(JSON.stringify(r));
    return first.featureId;
  };
  const fa = report(anna, { kategorie: 'strasse', foto: FILE, telefon: SECRET });
  const fb = report(bernd, { telefon: NOTE });
  return {
    c,
    pair: { featureId: fa, property: 'telefon' },
    photo: { featureId: fa, property: 'foto' },
    note: { featureId: fb, property: 'telefon' },
  };
}

export const snapshot = (db: Db, dir: string, file = 'project-baum.db'): string => {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  db.exec(`VACUUM INTO '${path}'`);
  return path;
};

/** Ordinary runs of the erasure task (A-021), one per subject. Returns the run ids. */
export const erase = (c: Ctx): string[] =>
  ['anna', 'bernd'].map((subject) => {
    const run = eraseRun(c, subject, root);
    expect(c.store.submit(run).outcome).toBe('accepted');
    return run.id;
  });

export interface World {
  readonly snap: string;
  readonly journal: Journal;
  readonly runs: string[];
  readonly pair: Seeded['pair'];
  readonly photo: Seeded['photo'];
  readonly note: Seeded['note'];
}
/** Pre-erasure snapshot, then the erasure on the live database, then the journal exported from the live data dir. */
export function world(): World {
  const { c, pair, photo, note } = seed();
  const snap = tmp();
  snapshot(c.db, snap);
  const runs = erase(c);
  const live = tmp();
  openControlDb(join(live, 'control.db')).close();
  snapshot(c.db, live);
  return { snap, journal: exportJournal(live), runs, pair, photo, note };
}

/** Every byte of the database file (and its WAL) as text: the erased value must not be in it either. */
export const dbBytes = (dir: string, file = 'project-baum.db'): string =>
  readdirSync(dir)
    .filter((f) => f.startsWith(file))
    .map((f) => readFileSync(join(dir, f)).toString('latin1'))
    .join('');

/** A `restore` seam that copies the seeded file from `snapDir` into the restore output. */
export const restorer =
  (snapDir: string) =>
  (_url: string, out: string): { ok: boolean; message: string } => {
    const from = join(snapDir, basename(out).replace(STAGING_SUFFIX, ''));
    if (!existsSync(from)) return { ok: false, message: 'not in replica' };
    copyFileSync(from, out);
    return { ok: true, message: '' };
  };

/** What any reader can get at: observations, run inputs, blobs, folded features. */
export function readable(dbPath: string): string {
  const db = openSqlite(dbPath);
  try {
    return JSON.stringify([
      db.prepare('SELECT * FROM observations').all(),
      db.prepare('SELECT input FROM runs').all(),
      db.prepare('SELECT * FROM blobs').all(),
      db.prepare('SELECT * FROM features').all(),
    ]);
  } finally {
    db.close();
  }
}

export function headOf(path: string): unknown {
  const db = openSqlite(path);
  try {
    return db.prepare('SELECT max(seq) AS s, (SELECT count(*) FROM runs) AS r FROM observations').get();
  } finally {
    db.close();
  }
}
