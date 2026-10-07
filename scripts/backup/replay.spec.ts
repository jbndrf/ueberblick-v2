// WP-536: a restore from a pre-erasure snapshot must not resurrect erased values (idempotent replay, publish after replay).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSqlite } from '../../packages/server/src/db/driver';
import { openControlDb } from '../../packages/server/src/db/open';
import { eraseRun, sabine } from '../../packages/server/src/store/run/erasure.testkit';
import { generateConfig } from './config.mjs';
import { exportJournal, type JournalEntry, type JournalErasure } from './journal.mjs';
import { replayProject, restoreWithReplay } from './replay.mjs';
import {
  CLOCK,
  NOTE,
  SECRET,
  SHA,
  dbBytes as bytes,
  erase,
  headOf,
  readable,
  restorer,
  seed,
  snapshot,
  tmp,
  world,
  type World,
} from './erasure-world';

describe('erasure journal', () => {
  it('has one entry per original erasure run: subject, actor, task, input, source run, time and the pairs it blanked', () => {
    const { journal, runs, pair, photo, note } = world();
    const e = entryOf(journal).erasures;
    expect(e.map((x) => [x.subject, x.sourceRun, x.actor, x.task, x.input])).toEqual([
      ['anna', runs[0], 'root', 'erase_subject', { subject: 'anna' }],
      ['bernd', runs[1], 'root', 'erase_subject', { subject: 'bernd' }],
    ]);
    expect(e[0]?.pairs).toEqual(expect.arrayContaining([pair, photo]));
    expect(e[0]?.pairs).toHaveLength(2);
    expect(typeof e[0]?.created).toBe('string');
    expect(e[1]?.pairs).toEqual([note]);
    expect(JSON.parse(JSON.stringify(journal))).toEqual(journal);
    expect(JSON.stringify(journal)).not.toContain(SECRET);
    expect(JSON.stringify(journal)).not.toContain(NOTE);
  });

  it('an ordinary run that names an erased subject and only clears a property is not an erasure run', () => {
    const { c, note } = seed();
    const snap = tmp();
    snapshot(c.db, snap);
    const [first] = erase(c);
    c.db
      .prepare(
        `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
         VALUES ('${'00000000-0000-7000-8000-000000006000'}', 'carl', 'participant', 'melden', 1, ?, '2026-10-01T08:00:00.000Z', 'accepted')`,
      )
      .run(JSON.stringify({ subject: 'anna' }));
    const live = tmp();
    openControlDb(join(live, 'control.db')).close();
    snapshot(c.db, live);
    const journal = exportJournal(live);
    // bernd was erased too; only anna's entry is replayed here.
    const anna1 = entryOf(journal).erasures.filter((e) => e.sourceRun === first);
    expect(anna1).toHaveLength(1);
    const path = join(snap, 'project-baum.db');
    replayProject(path, { erasures: anna1 }, { clock: CLOCK });
    const db = openSqlite(path);
    expect(
      db
        .prepare("SELECT result FROM observations WHERE feature_id = ? AND property = 'telefon' ORDER BY seq")
        .all(note.featureId),
    ).toEqual([{ result: JSON.stringify(NOTE) }]);
    db.close();
  });
});

describe('replayProject', () => {
  it('a snapshot from before the erasure holds the secret; after the replay no erased value is readable', () => {
    const { snap, journal } = world();
    const path = join(snap, 'project-baum.db');
    expect(readable(path)).toContain(SECRET);
    expect(readable(path)).toContain(SHA);
    const r = replayProject(path, entryOf(journal), { clock: CLOCK });
    const after = readable(path);
    expect(after).not.toContain(SECRET);
    expect(after).not.toContain(NOTE);
    expect(after).not.toContain(SHA);
    expect(bytes(snap)).not.toContain(SECRET);
    const db = openSqlite(path);
    expect(db.prepare("SELECT id FROM tombstones WHERE kind = 'blob'").all()).toEqual([{ id: SHA }]);
    expect(r.orphanedBlobs).toEqual([SHA]);
    db.close();
  });

  it('submits each original erasure run as an ordinary run: same id, task and input, under the restore actor', () => {
    const { snap, journal, runs } = world();
    const path = join(snap, 'project-baum.db');
    expect(replayProject(path, entryOf(journal), { clock: CLOCK }).replayed).toBe(2);
    const db = openSqlite(path);
    const rows = db
      .prepare("SELECT id, actor, task, input FROM runs WHERE task = 'erase_subject' ORDER BY id")
      .all() as { id: string; actor: string; task: string; input: string }[];
    expect(rows.map((r) => [r.id, r.actor, r.task, JSON.parse(r.input)])).toEqual(
      [
        [runs[0], 'restore', 'erase_subject', { subject: 'anna' }],
        [runs[1], 'restore', 'erase_subject', { subject: 'bernd' }],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    expect(db.prepare('SELECT subject, erased_at FROM erasure_subjects ORDER BY subject').all()).toEqual(
      entryOf(journal).erasures.map((x) => ({ subject: x.subject, erased_at: x.erasedAt })),
    );
    db.close();
  });

  it('several journal entries of one source run replay as one run, and every subject row is set', () => {
    const { snap, journal } = world();
    const path = join(snap, 'project-baum.db');
    const two = { erasures: [erasureOf(journal, 0), { ...erasureOf(journal, 0), subject: 'dora' }] };
    expect(replayProject(path, two as JournalEntry, { clock: CLOCK }).replayed).toBe(1);
    expect(readable(path)).not.toContain(SECRET);
    const d = openSqlite(path);
    expect(d.prepare('SELECT subject FROM erasure_subjects ORDER BY subject').all()).toEqual([
      { subject: 'anna' },
      { subject: 'dora' },
    ]);
    d.close();
  });

  it('fails loudly, naming the entry, when the task is missing in the config version', () => {
    const { snap, journal } = world();
    const path = join(snap, 'project-baum.db');
    const before = readable(path);
    const gone = { erasures: [{ ...erasureOf(journal, 0), task: 'no_such_task' }] };
    expect(() => replayProject(path, gone as JournalEntry, { clock: CLOCK })).toThrow(
      new RegExp(
        `journaled erasure ${erasureOf(journal, 0).sourceRun} \\(task no_such_task\\).*does not exist`,
      ),
    );
    expect(readable(path)).toBe(before);
  });

  it('an erasure originally run by a role-gated participant replays (replay does not depend on the original roles)', () => {
    const { c } = seed();
    const snap = tmp();
    snapshot(c.db, snap);
    c.db.prepare("INSERT OR IGNORE INTO participants (id, name, roles) VALUES ('anna', NULL, '[]')").run();
    const run = eraseRun(c, 'anna', sabine);
    expect(c.store.submit(run).outcome).toBe('accepted');
    const live = tmp();
    openControlDb(join(live, 'control.db')).close();
    snapshot(c.db, live);
    const journal = exportJournal(live);
    expect(entryOf(journal).erasures[0]).toMatchObject({ actor: 'sabine', actorKind: 'participant' });
    const path = join(snap, 'project-baum.db');
    expect(replayProject(path, entryOf(journal), { clock: CLOCK }).replayed).toBe(1);
    expect(readable(path)).not.toContain(SECRET);
    const db = openSqlite(path);
    expect(db.prepare('SELECT id, actor FROM runs WHERE id = ?').get(run.id)).toEqual({
      id: run.id,
      actor: 'restore',
    });
    db.close();
  });

  it('fails loudly, naming the entry, when the task refuses the replay actor', () => {
    const { snap, journal } = world();
    const path = join(snap, 'project-baum.db');
    const gated = { erasures: [{ ...erasureOf(journal, 0), task: 'melden' }] };
    expect(() => replayProject(path, gated as JournalEntry, { clock: CLOCK })).toThrow(
      /journaled erasure .* \(task melden\) was refused on replay/,
    );
  });

  it('refuses a journaled erasure without a subject (no fallback, nothing written)', () => {
    const { snap, journal } = world();
    const path = join(snap, 'project-baum.db');
    const before = readable(path);
    const bad = { erasures: [{ ...erasureOf(journal, 0), subject: '' }] };
    expect(() => replayProject(path, bad as JournalEntry, { clock: CLOCK })).toThrow(/no subject/);
    expect(readable(path)).toBe(before);
  });

  it('is idempotent: a second replay changes nothing and replays nothing (an empty entry too)', () => {
    expect(
      replayProject(join(world().snap, 'project-baum.db'), { erasures: [] }, { clock: CLOCK }).replayed,
    ).toBe(0);
    const { snap, journal } = world();
    const path = join(snap, 'project-baum.db');
    const entry = entryOf(journal);
    replayProject(path, entry, { clock: CLOCK });
    const once = readable(path);
    const head = headOf(path);
    const again = replayProject(path, entry, { clock: CLOCK });
    expect(again.replayed).toBe(0);
    expect(readable(path)).toBe(once);
    expect(headOf(path)).toEqual(head);
  });
});

describe('restoreWithReplay', () => {
  const run = (snap: string, data: string, journal: unknown) =>
    restoreWithReplay({
      replica: 'file:///replica',
      dataDir: data,
      databases: ['control.db', 'project-baum.db'],
      journal: journal as never,
      restore: restorer(snap),
      clock: CLOCK,
    });

  it('publishes the restored databases only after the replay, with no erased value readable', () => {
    const { snap, journal } = world();
    openControlDb(join(snap, 'control.db')).close();
    const data = tmp();
    const r = run(snap, data, journal);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(readdirSync(data).sort()).toEqual(['control.db', 'project-baum.db']);
    expect(bytes(data)).not.toContain(SECRET);
    expect(readable(join(data, 'project-baum.db'))).not.toContain(SECRET);
  });

  it('publishes nothing (all or none, no staging leftovers) when the replay cannot run', () => {
    const { snap, journal } = world();
    openControlDb(join(snap, 'control.db')).close();
    const db = openSqlite(join(snap, 'project-baum.db'));
    db.exec('DELETE FROM config_versions');
    db.close();
    const data = tmp();
    const r = run(snap, data, journal);
    expect(r.ok).toBe(false);
    expect(existsSync(join(data, 'project-baum.db'))).toBe(false);
    expect(readdirSync(data)).toEqual([]);
    expect(r.problems.join()).toMatch(/project-baum\.db/);
  });

  it('refuses without a journal, and refuses to overwrite an existing database', () => {
    const { snap, journal } = world();
    openControlDb(join(snap, 'control.db')).close();
    const data = tmp();
    expect(run(snap, data, undefined).ok).toBe(false);
    expect(readdirSync(data)).toEqual([]);
    openControlDb(join(data, 'control.db')).close();
    const r = run(snap, data, journal);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/exists/);
  });

  it('a repeated restore of the same snapshot ends in the same state', () => {
    const { snap, journal } = world();
    openControlDb(join(snap, 'control.db')).close();
    const a = tmp();
    const b = tmp();
    expect(run(snap, a, journal).ok).toBe(true);
    expect(run(snap, b, journal).ok).toBe(true);
    expect(readable(join(a, 'project-baum.db'))).toBe(readable(join(b, 'project-baum.db')));
  });
});

describe('retention in the generated config', () => {
  it('defaults to 30 days (needs-owner) and can be set', () => {
    const dir = tmp();
    openControlDb(join(dir, 'control.db')).close();
    const yml = generateConfig({ dataDir: dir, replicaBase: 's3://b/p' });
    expect(yml).toContain('retention: 720h');
    expect(yml).toMatch(/needs-owner/);
    expect(generateConfig({ dataDir: dir, replicaBase: 's3://b/p', retention: '240h' })).toContain(
      'retention: 240h',
    );
  });
});

function entryOf(journal: World['journal']): JournalEntry {
  const e = journal.projects['project-baum.db'];
  if (e === undefined) throw new Error('journal has no entry for project-baum.db');
  return e;
}

function erasureOf(journal: World['journal'], i: number): JournalErasure {
  const e = entryOf(journal).erasures[i];
  if (e === undefined) throw new Error(`journal has no erasure ${i}`);
  return e;
}
