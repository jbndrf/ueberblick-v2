// WP-943: backup to a local folder. Config generation follows new databases, files sync incrementally, restore puts it all back.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openControlDb, openProjectDb } from '../../packages/server/src/db/open';
import { NOTE, SECRET, SHA, dbBytes, readable, restorer, world } from './erasure-world';
import { syncTree } from './files.mjs';
import { folderLayout } from './layout.mjs';
import { restoreFromFolder } from './restore.mjs';
import { backupRound, refreshConfig } from './run.mjs';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ub-folder-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const put = (root: string, rel: string, text: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};

describe('refreshConfig', () => {
  it('lists every database, including a project database created later, and reports a change only then', () => {
    const data = tmp();
    const backup = tmp();
    openControlDb(join(data, 'control.db')).close();
    const configPath = join(tmp(), 'litestream.yml');
    const first = refreshConfig({ dataDir: data, backupDir: backup, configPath });
    expect(first.changed).toBe(true);
    expect(first.databases).toEqual(['control.db']);
    expect(refreshConfig({ dataDir: data, backupDir: backup, configPath }).changed).toBe(false);

    openProjectDb(data, 'baum').close();
    const second = refreshConfig({ dataDir: data, backupDir: backup, configPath });
    expect(second.changed).toBe(true);
    expect(second.databases).toEqual(['control.db', 'project-baum.db']);
    const yml = readFileSync(configPath, 'utf8');
    expect(yml).toContain(`path: ${join(data, 'project-baum.db')}`);
    expect(yml).toContain(`url: ${folderLayout(backup).replicaBase}/project-baum.db`);
    expect(yml).toContain('retention: 720h');
  });

  it('waits quietly while no control.db exists yet', () => {
    const r = refreshConfig({ dataDir: tmp(), backupDir: tmp(), configPath: join(tmp(), 'l.yml') });
    expect(r).toEqual({ changed: false, databases: [] });
  });
});

describe('syncTree', () => {
  it('copies only what is missing, then mirrors deletions, and never wipes the backup from an empty source', () => {
    const src = tmp();
    const dst = tmp();
    put(src, 'baum/aa/one.bin', 'one');
    put(src, 'baum/bb/two.bin', 'two');
    expect(syncTree(src, dst)).toEqual({ copied: 2, removed: 0 });
    expect(syncTree(src, dst)).toEqual({ copied: 0, removed: 0 });
    rmSync(join(src, 'baum/aa/one.bin'));
    expect(syncTree(src, dst)).toEqual({ copied: 0, removed: 1 });
    expect(existsSync(join(dst, 'baum/aa/one.bin'))).toBe(false);
    expect(readFileSync(join(dst, 'baum/bb/two.bin'), 'utf8')).toBe('two');
    rmSync(join(src, 'baum'), { recursive: true });
    expect(syncTree(src, dst)).toEqual({ copied: 0, removed: 0 });
    expect(existsSync(join(dst, 'baum/bb/two.bin'))).toBe(true);
  });

  it('treats a missing source as nothing to do', () => {
    expect(syncTree(join(tmp(), 'nope'), tmp())).toEqual({ copied: 0, removed: 0 });
  });
});

describe('backupRound', () => {
  it('never copies <data>/tiles-cache, a rebuildable cache (WP-971)', () => {
    const data = tmp();
    const backup = tmp();
    openControlDb(join(data, 'control.db')).close();
    put(data, 'blobs/baum/ab/blob.bin', 'bytes');
    put(data, 'tiles-cache/baum/osm/3/4/5.png', 'tile');
    put(data, 'tiles-cache/index.json', '{}');
    const r = backupRound({ dataDir: data, backupDir: backup });
    expect(r.problems).toEqual([]);
    expect(r.files.copied).toBe(1);
    const all = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name));
    const copied = all(backup);
    expect(copied.some((f) => f.endsWith('blob.bin'))).toBe(true);
    expect(copied.filter((f) => f.includes('tiles-cache') || f.endsWith('5.png'))).toEqual([]);
  });
});

describe('restoreFromFolder', () => {
  it('restores databases and files into an empty data dir; refuses a non-empty one and a missing journal', () => {
    const backup = tmp();
    const layout = folderLayout(backup);
    // a replica as Litestream leaves it: one directory per database; the fake restore copies the seeded file
    const seedDir = tmp();
    openControlDb(join(seedDir, 'control.db')).close();
    openProjectDb(seedDir, 'baum').close();
    for (const f of ['control.db', 'project-baum.db'])
      mkdirSync(join(layout.replicaDir, f), { recursive: true });
    put(backup, 'files/baum/ab/blob.bin', 'bytes');
    mkdirSync(join(backup, 'journal'), { recursive: true });
    writeFileSync(
      layout.journalPath,
      JSON.stringify({ version: 1, projects: { 'project-baum.db': { erasures: [] } } }),
    );
    const restore = (url: string, out: string): { ok: boolean; message: string } => {
      copyFileSync(join(seedDir, url.slice(url.lastIndexOf('/') + 1)), out);
      writeFileSync(`${out}.tmp-wal`, ''); // Litestream's scratch file
      return { ok: true, message: '' };
    };

    const data = join(tmp(), 'data');
    const r = restoreFromFolder({ backupDir: backup, dataDir: data, restore });
    expect(r.ok).toBe(true);
    expect(readdirSync(data).sort()).toEqual(['blobs', 'control.db', 'project-baum.db']);
    expect(readFileSync(join(data, 'blobs/baum/ab/blob.bin'), 'utf8')).toBe('bytes');

    const again = restoreFromFolder({ backupDir: backup, dataDir: data, restore });
    expect(again.ok).toBe(false);
    expect(again.problems.join()).toContain('not empty');

    writeFileSync(join(data, 'stale.txt'), 'old');
    const forced = restoreFromFolder({ backupDir: backup, dataDir: data, restore, force: true });
    expect(forced.ok).toBe(true);
    expect(existsSync(join(data, 'stale.txt'))).toBe(false);
    expect(existsSync(join(data, 'control.db'))).toBe(true);

    rmSync(layout.journalPath);
    writeFileSync(join(data, 'keep.txt'), 'kept');
    expect(restoreFromFolder({ backupDir: backup, dataDir: data, restore, force: true }).ok).toBe(false);
    expect(existsSync(join(data, 'keep.txt'))).toBe(true); // a failed check never wipes
    const noJournal = restoreFromFolder({ backupDir: backup, dataDir: join(tmp(), 'd2'), restore });
    expect(noJournal.ok).toBe(false);
    expect(noJournal.problems.join()).toContain('journal');
  });

  describe('with --force, a failure leaves the old data untouched', () => {
    const OLD = { 'control.db': 'old-control-bytes', 'blobs/x/y.bin': 'old-blob', 'keep.txt': 'kept' };
    const arrange = (
      journal: unknown = { version: 1, projects: { 'project-baum.db': { erasures: [] } } },
    ) => {
      const backup = tmp();
      const layout = folderLayout(backup);
      mkdirSync(join(layout.replicaDir, 'project-baum.db'), { recursive: true });
      mkdirSync(layout.journalDir, { recursive: true });
      writeFileSync(layout.journalPath, JSON.stringify(journal));
      const data = tmp();
      for (const [rel, text] of Object.entries(OLD)) put(data, rel, text);
      return { backup, data };
    };
    const untouched = (data: string): void => {
      expect(readdirSync(data).sort()).toEqual(['blobs', 'control.db', 'keep.txt']);
      for (const [rel, text] of Object.entries(OLD)) expect(readFileSync(join(data, rel), 'utf8')).toBe(text);
    };

    it('(a) when the restore returns ok:false', () => {
      const { backup, data } = arrange();
      const r = restoreFromFolder({
        backupDir: backup,
        dataDir: data,
        force: true,
        restore: () => ({ ok: false, message: 'replica is empty' }),
      });
      expect(r.ok).toBe(false);
      untouched(data);
    });

    it('(b) when Litestream is missing', () => {
      const { backup, data } = arrange();
      const r = restoreFromFolder({ backupDir: backup, dataDir: data, force: true, pathEnv: '' });
      expect(r.ok).toBe(false);
      expect(r.problems.join()).toContain('Litestream');
      untouched(data);
    });

    it('(c) when the replay refuses', () => {
      const w = world();
      const { backup, data } = arrange({
        ...w.journal,
        projects: {
          'project-baum.db': {
            erasures: [
              {
                subject: 'anna',
                sourceRun: 'r-gone',
                task: 'no-such-task',
                input: {},
                erasedAt: 'x',
                pairs: [],
              },
            ],
          },
        },
      });
      const r = restoreFromFolder({
        backupDir: backup,
        dataDir: data,
        force: true,
        restore: restorer(w.snap),
      });
      expect(r.ok).toBe(false);
      expect(r.problems.join()).toContain('task does not exist');
      untouched(data);
    });
  });

  describe('the swap into place (over existing data)', () => {
    const OLD = { 'control.db': 'old-control-bytes', 'blobs/x/y.bin': 'old-blob', 'keep.txt': 'kept' };
    const arrange = () => {
      const backup = tmp();
      const layout = folderLayout(backup);
      mkdirSync(join(layout.replicaDir, 'project-baum.db'), { recursive: true });
      mkdirSync(layout.journalDir, { recursive: true });
      writeFileSync(
        layout.journalPath,
        JSON.stringify({ version: 1, projects: { 'project-baum.db': { erasures: [] } } }),
      );
      const snap = tmp();
      openProjectDb(snap, 'baum').close(); // a valid database the restorer can put into staging
      const data = tmp();
      return {
        backup,
        data,
        snap,
        oldDir: join(data, '.restore-old'),
        staging: join(data, '.restore-staging'),
      };
    };
    const seedOld = (data: string): void => {
      for (const [rel, text] of Object.entries(OLD)) put(data, rel, text);
    };

    it('a rename failure mid-swap is rolled back: the old data is back, byte-identical, and nothing changed', () => {
      const { backup, data, snap, oldDir, staging } = arrange();
      seedOld(data);
      const flaky = (from: string, to: string): void => {
        if (to === join(data, 'project-baum.db')) throw new Error('injected rename failure');
        renameSync(from, to);
      };
      const r = restoreFromFolder({
        backupDir: backup,
        dataDir: data,
        force: true,
        restore: restorer(snap),
        rename: flaky,
      });
      expect(r.ok).toBe(false);
      expect(r.problems.join()).toContain('the data folder was not changed');
      expect(readdirSync(data).sort()).toEqual(['.restore-staging', 'blobs', 'control.db', 'keep.txt']);
      for (const [rel, text] of Object.entries(OLD)) expect(readFileSync(join(data, rel), 'utf8')).toBe(text);
      expect(existsSync(join(staging, 'project-baum.db'))).toBe(true); // the restored data stays for the next run
      expect(existsSync(oldDir)).toBe(false); // the old data was put back: no leftover
    });

    it('a failed rollback deletes nothing and names where the old data and the restored data are', () => {
      const { backup, data, snap, oldDir, staging } = arrange();
      seedOld(data);
      const broken = (from: string, to: string): void => {
        if (to === join(data, 'project-baum.db')) throw new Error('injected rename failure');
        if (from.startsWith(`${oldDir}/`)) throw new Error('injected rollback failure');
        renameSync(from, to);
      };
      const r = restoreFromFolder({
        backupDir: backup,
        dataDir: data,
        force: true,
        restore: restorer(snap),
        rename: broken,
      });
      expect(r.ok).toBe(false);
      const p = r.problems.join();
      expect(p).toContain('rollback');
      expect(p).toContain(oldDir);
      expect(p).toContain(staging);
      for (const [rel, text] of Object.entries(OLD))
        expect(readFileSync(join(oldDir, rel), 'utf8')).toBe(text);
      expect(existsSync(join(staging, 'project-baum.db'))).toBe(true);
    });

    it('a failed delete of .restore-old after the swap is a success with a warning, never a rollback', () => {
      const { backup, data, snap, oldDir, staging } = arrange();
      seedOld(data);
      const halfRemove = (path: string): void => {
        rmSync(join(path, 'keep.txt')); // part of the old data is already gone when the delete fails
        throw new Error('injected delete failure');
      };
      const r = restoreFromFolder({
        backupDir: backup,
        dataDir: data,
        force: true,
        restore: restorer(snap),
        remove: halfRemove,
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.problems).toEqual([]);
      expect(r.warnings?.join()).toContain('Restore succeeded');
      expect(r.warnings?.join()).toContain(oldDir);
      expect(existsSync(join(data, 'project-baum.db'))).toBe(true); // the restored data stays in place
      expect(existsSync(join(data, 'control.db'))).toBe(false); // the old entries were not moved back
      expect(existsSync(staging)).toBe(false);
      expect(readFileSync(join(oldDir, 'control.db'), 'utf8')).toBe(OLD['control.db']); // survivors untouched
      // the leftover blocks neither the backup service nor, silently, the next restore
      openControlDb(join(data, 'control.db')).close();
      const configPath = join(tmp(), 'litestream.yml');
      expect(refreshConfig({ dataDir: data, backupDir: backup, configPath }).databases).toContain(
        'control.db',
      );
      const again = restoreFromFolder({ backupDir: backup, dataDir: data, restore: restorer(snap) });
      expect(again.ok).toBe(false);
      expect(again.problems.join()).toContain('not empty');
      expect(readFileSync(join(oldDir, 'control.db'), 'utf8')).toBe(OLD['control.db']);
    });

    it('a leftover .restore-old from a crash refuses the restore, unless --force is given', () => {
      const { backup, data, snap, oldDir } = arrange();
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(join(oldDir, 'control.db'), 'old-control-bytes');
      const r = restoreFromFolder({ backupDir: backup, dataDir: data, restore: restorer(snap) });
      expect(r.ok).toBe(false);
      expect(r.problems.join()).toContain('.restore-old');
      expect(readFileSync(join(oldDir, 'control.db'), 'utf8')).toBe('old-control-bytes');
      const forced = restoreFromFolder({
        backupDir: backup,
        dataDir: data,
        force: true,
        restore: restorer(snap),
      });
      expect(forced.ok, JSON.stringify(forced)).toBe(true);
      expect(existsSync(oldDir)).toBe(false);
      expect(existsSync(join(data, 'project-baum.db'))).toBe(true);
    });
  });

  it('replays the journal on the restored project database: an erased value is gone afterwards', () => {
    const w = world(); // the snapshot still holds the values; the journal holds the erasures
    expect(dbBytes(w.snap)).toContain(SECRET);
    const backup = tmp();
    const layout = folderLayout(backup);
    mkdirSync(join(layout.replicaDir, 'project-baum.db'), { recursive: true });
    mkdirSync(layout.journalDir, { recursive: true });
    writeFileSync(layout.journalPath, JSON.stringify(w.journal));
    const data = join(tmp(), 'data');
    const r = restoreFromFolder({ backupDir: backup, dataDir: data, restore: restorer(w.snap) });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(readdirSync(data)).toEqual(['project-baum.db']);
    expect(dbBytes(data)).not.toContain(SECRET);
    expect(dbBytes(data)).not.toContain(NOTE);
    expect(readable(join(data, 'project-baum.db'))).not.toContain(SHA);
  });
});

describe('backupRound', () => {
  it('writes journal/journal.json from the data dir', () => {
    const data = tmp();
    const backup = tmp();
    openControlDb(join(data, 'control.db')).close();
    const r = backupRound({ dataDir: data, backupDir: backup });
    expect(r.problems).toEqual([]);
    const journal = JSON.parse(readFileSync(folderLayout(backup).journalPath, 'utf8'));
    expect(journal.projects).toBeDefined();
  });
});
