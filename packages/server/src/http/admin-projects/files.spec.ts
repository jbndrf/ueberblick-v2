import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openControlDb, openProjectDb, projectDbPath, ReservedProjectKey } from '../../db/open';
import { previewBlobDir, previewDbPath } from '../../preview/registry';
import { packsDir } from '../packs/wiring';
import { deleteProject } from './delete';
import { removeProjectFiles, sweepRetiredProjects } from './files';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function lay(dataDir: string, key: string): string[] {
  openProjectDb(dataDir, key).close();
  const paths = [
    projectDbPath(dataDir, key),
    previewDbPath(dataDir, key),
    join(dataDir, 'blobs', key),
    previewBlobDir(dataDir, key),
    packsDir(dataDir, key),
    join(dataDir, 'tiles-cache', key),
  ];
  for (const p of paths.slice(1)) {
    if (p.endsWith('.db')) writeFileSync(p, 'x');
    else {
      mkdirSync(p, { recursive: true });
      writeFileSync(join(p, 'f'), 'x');
    }
  }
  return paths;
}

function world() {
  const dataDir = mkdtempSync(join(tmpdir(), 'sweep-'));
  dirs.push(dataDir);
  const control = openControlDb(join(dataDir, 'control.db'));
  const retire = (key: string): void => {
    control.prepare('INSERT INTO retired_projects (key, retired_at) VALUES (?,?)').run(key, 'x');
  };
  return { dataDir, control, retire };
}

describe('sweepRetiredProjects', () => {
  it('finishes a delete whose file removal failed; the key stays retired', () => {
    const w = world();
    const paths = lay(w.dataDir, 'baeume');
    w.control.prepare("INSERT INTO projects (id, key, name, created_at) VALUES ('p','baeume','B','x')").run();
    const failing = (): void => {
      throw new Error('EBUSY');
    };
    const deps = {
      control: w.control,
      dataDir: w.dataDir,
      clock: { now: () => 'x' },
      dropPreview: () => undefined,
      closeProject: () => undefined,
      removeFiles: failing,
    };
    expect(() => deleteProject(deps, 'baeume')).toThrow('EBUSY');
    for (const p of paths) expect(existsSync(p)).toBe(true);
    const errors: string[] = [];
    const sweep = { control: w.control, dataDir: w.dataDir, onError: (k: string) => errors.push(k) };
    expect(sweepRetiredProjects(sweep)).toBe(1);
    for (const p of paths) expect(existsSync(p)).toBe(false);
    expect(errors).toEqual([]);
    expect(w.control.prepare('SELECT key FROM retired_projects').all()).toHaveLength(1);
  });

  it('never touches the files of a key that is not retired', () => {
    const w = world();
    const mine = lay(w.dataDir, 'alt');
    const other = lay(w.dataDir, 'import_laeuft');
    w.retire('alt');
    sweepRetiredProjects({ control: w.control, dataDir: w.dataDir, onError: () => undefined });
    for (const p of mine) expect(existsSync(p)).toBe(false);
    for (const p of other) expect(existsSync(p)).toBe(true);
  });

  it('is idempotent and a failure does not throw; the next key is still swept', () => {
    const w = world();
    w.retire('alpha');
    w.retire('beta');
    const swept: string[] = [];
    const errors: string[] = [];
    const removeFiles = (_d: string, key: string): void => {
      if (key === 'alpha') throw new Error('EBUSY');
      swept.push(key);
    };
    const run = (): number =>
      sweepRetiredProjects({
        control: w.control,
        dataDir: w.dataDir,
        onError: (k) => errors.push(k),
        removeFiles,
      });
    expect(run()).toBe(1);
    expect(run()).toBe(1);
    expect(swept).toEqual(['beta', 'beta']);
    expect(errors).toEqual(['alpha', 'alpha']);
    lay(w.dataDir, 'alpha');
    removeProjectFiles(w.dataDir, 'alpha');
    removeProjectFiles(w.dataDir, 'alpha');
    expect(existsSync(projectDbPath(w.dataDir, 'alpha'))).toBe(false);
  });
});

describe('removeProjectFiles and reserved keys', () => {
  it.each(['tiles', 'packs'])('refuses %s and deletes nothing', (key) => {
    const dir = mkdtempSync(join(tmpdir(), 'reserved-'));
    mkdirSync(join(dir, 'blobs', key, 'other'), { recursive: true });
    writeFileSync(join(dir, 'blobs', key, 'other', 'a.pmtiles'), 'x');
    expect(() => removeProjectFiles(dir, key)).toThrow(ReservedProjectKey);
    expect(existsSync(join(dir, 'blobs', key, 'other', 'a.pmtiles'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
