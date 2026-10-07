import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverDatabases } from '../../../../scripts/backup/config.mjs';
import { createProject } from '../admin/bootstrap';
import { migrationState } from '../db/migrate';
import { openControlDb, openProjectDb, openProjectDbFile } from '../db/open';
import { PROJECT_MIGRATIONS } from '../db/project-schema';
import {
  dropPreview,
  ensurePreview,
  findPreview,
  previewBlobDir,
  previewDbPath,
  previewKeys,
  previewOf,
} from './registry';

const clock = { now: () => '2026-10-01T08:00:00Z' };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ub-preview-'));
  dirs.push(dir);
  const control = openControlDb(':memory:');
  const project = createProject(control, { key: 'baeume', name: 'Bäume' }, clock);
  return { dir, control, project };
}
const count = (control: ReturnType<typeof openControlDb>, table: string): number =>
  control.prepare<{ n: number }>(`SELECT count(*) n FROM ${table}`).get()?.n ?? 0;

describe('ensurePreview', () => {
  it('twice gives one row and one migrated database', () => {
    const { dir, control, project } = world();
    const a = ensurePreview(control, dir, project.id, clock);
    const b = ensurePreview(control, dir, project.id, clock);
    expect(b).toEqual(a);
    expect(a.key).toBe('baeume__vorschau');
    expect(count(control, 'previews')).toBe(1);
    expect(readdirSync(dir).filter((f) => f.startsWith('preview-'))).toEqual(['preview-baeume.db']);
    const db = openProjectDbFile(previewDbPath(dir, 'baeume'));
    expect(migrationState(db, PROJECT_MIGRATIONS).pending).toEqual([]);
    expect(previewOf(control, project.id)).toMatchObject({ generation: 1, status: 'ready' });
  });

  it('refuses an unknown project', () => {
    const { dir, control } = world();
    expect(() => ensurePreview(control, dir, 'nope', clock)).toThrow(/unknown project/);
  });
});

describe('dropPreview', () => {
  it('removes the file and the blob dir, ends its sessions and logins, and bumps the generation', () => {
    const { dir, control, project } = world();
    const { id, key } = ensurePreview(control, dir, project.id, clock);
    mkdirSync(previewBlobDir(dir, 'baeume'), { recursive: true });
    writeFileSync(join(previewBlobDir(dir, 'baeume'), 'x'), 'bytes');
    control
      .prepare('INSERT INTO credentials (token, project_id, participant_id) VALUES (?,?,?)')
      .run('T', id, 'p1');
    control
      .prepare('INSERT INTO sessions (id_hash, subject, project_id, expires_at) VALUES (?,?,?,?)')
      .run('h', 'participant:p1', id, '2099');
    control
      .prepare('INSERT INTO credentials (token, project_id, participant_id) VALUES (?,?,?)')
      .run('REAL', project.id, 'p1');

    dropPreview(control, dir, project.id);
    expect(existsSync(previewDbPath(dir, 'baeume'))).toBe(false);
    expect(existsSync(previewBlobDir(dir, 'baeume'))).toBe(false);
    expect(previewOf(control, project.id)).toMatchObject({ generation: 2, status: 'dropped' });
    expect(findPreview(control, key)).toBeUndefined();
    expect(previewKeys(control)).toEqual([]);
    expect(count(control, 'sessions')).toBe(0);
    expect(count(control, 'credentials')).toBe(1); // the real project's login stays

    // lazily re-created, with the same id and the bumped generation
    expect(ensurePreview(control, dir, project.id, clock)).toEqual({ id, key });
    expect(existsSync(previewDbPath(dir, 'baeume'))).toBe(true);
    expect(previewOf(control, project.id)).toMatchObject({ generation: 2, status: 'ready' });
    dropPreview(control, dir, project.id);
    expect(previewOf(control, project.id)?.generation).toBe(3);
  });

  it('is a no-op without a preview', () => {
    const { dir, control, project } = world();
    expect(() => dropPreview(control, dir, project.id)).not.toThrow();
  });
});

describe('isolation of the files', () => {
  it('the backup discovers control.db and project databases, never preview-*.db', () => {
    const { dir, control, project } = world();
    writeFileSync(join(dir, 'control.db'), '');
    openProjectDb(dir, 'baeume').close();
    ensurePreview(control, dir, project.id, clock);
    expect(readdirSync(dir)).toContain('preview-baeume.db');
    expect(discoverDatabases(dir)).toEqual(['control.db', 'project-baeume.db']);
  });

  it('a project key never contains __, so it cannot collide with a served preview key', () => {
    const control = openControlDb(':memory:');
    for (const key of ['a__vorschau', 'a__b'])
      expect(() => createProject(control, { key, name: 'x' }, clock)).toThrow(/invalid project key/);
    expect(() => openProjectDb(':memory:', 'a__vorschau')).toThrow(/invalid project key/);
  });
});
