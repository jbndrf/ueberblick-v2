import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from './runtime';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ub-restoreguard-'));
  dirs.push(d);
  return d;
};
const opts = (dataDir: string) => ({ dataDir, secureCookies: false, sink: () => undefined });

describe('refuse to boot mid-restore (WP-160)', () => {
  it('throws naming the files and the restore command, and creates nothing', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'project-baum.db.restoring'), 'half');
    writeFileSync(join(dir, 'control.db.restoring'), 'half');
    const before = readdirSync(dir).sort();
    let message = '';
    try {
      createRuntime(opts(dir));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('control.db.restoring');
    expect(message).toContain('project-baum.db.restoring');
    expect(message).toContain('backup:restore');
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it('a missing data dir is still created, and an ordinary one boots', () => {
    const dir = join(scratch(), 'fresh');
    createRuntime(opts(dir)).stop();
    expect(readdirSync(dir)).toContain('control.db');
    createRuntime(opts(dir)).stop();
  });

  it('a restoring file in a subdirectory (blobs) is not a restore marker', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'blobs'));
    writeFileSync(join(dir, 'blobs', 'x.restoring'), '');
    createRuntime(opts(dir)).stop();
  });
});

describe('root backup scripts (WP-160)', () => {
  it('backup:restore --help prints the usage', () => {
    const r = spawnSync('npm', ['run', '-s', 'backup:restore', '--', '--help'], { encoding: 'utf8' });
    expect(`${r.stdout}${r.stderr}`).toContain('usage:');
    expect(r.status).toBe(0);
  });
  it('backup:journal --help prints the usage and exits 0', () => {
    const r = spawnSync('npm', ['run', '-s', 'backup:journal', '--', '--help'], { encoding: 'utf8' });
    expect(`${r.stdout}${r.stderr}`).toContain('usage:');
    expect(r.status).toBe(0);
  });
});
