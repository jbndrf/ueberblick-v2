import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '../../auth/contract';
import { createAuth } from '../../auth';
import { createProjectFromTemplate } from '../../admin/create-project';
import { openControlDb, openProjectDb, openProjectDbFile, projectDbPath } from '../../db/open';
import type { Db } from '../../db/driver';
import { dropPreview, ensurePreview, previewDbPath, findPreview } from '../../preview/registry';
import { createProjectDeleteHandlers, deleteCounts, deleteProject } from './delete';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const clock = { now: () => '2026-10-02T08:00:00.000Z' };

async function world() {
  const dataDir = mkdtempSync(join(tmpdir(), 'del-'));
  dirs.push(dataDir);
  const control = openControlDb(join(dataDir, 'control.db'));
  const open = new Map<string, Db>();
  const projectDb = (key: string): Db => {
    let db = open.get(key);
    if (!db) open.set(key, (db = openProjectDb(dataDir, key)));
    return db;
  };
  const auth = createAuth({ control, now: () => new Date(0), participantRoles: () => [] });
  const owner = await auth.createAdmin('a@example.org', 'correct horse battery');
  const stranger = await auth.createAdmin('b@example.org', 'correct horse battery');
  const project = createProjectFromTemplate(
    control,
    projectDb,
    { name: 'Bäume Süd', description: '', template: 'leer@1' },
    owner,
    clock,
  );
  // every artefact of the project
  projectDb(project.key)
    .prepare("INSERT INTO participants (id, name, roles, attrs) VALUES ('anna','Anna','[]', NULL)")
    .run();
  for (const dir of [
    join(dataDir, 'blobs', project.key),
    join(dataDir, 'blobs', 'packs', project.key),
    join(dataDir, 'blobs', 'tiles', project.key),
    join(dataDir, 'tiles-cache', project.key),
  ]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'f'), 'x');
  }
  const preview = ensurePreview(control, dataDir, project.id, clock);
  open.set(preview.key, openProjectDbFile(previewDbPath(dataDir, project.key))); // the preview's open handle
  mkdirSync(join(dataDir, 'blobs', preview.key), { recursive: true });
  writeFileSync(join(dataDir, 'blobs', preview.key, 'f'), 'x');
  auth.issueCredential(project.id, 'anna');
  control
    .prepare(
      "INSERT INTO api_tokens (id, token_hash, project_id, participant_id, label, last_four, created_at) VALUES ('t','h',?,'anna','L','abcd','x')",
    )
    .run(project.id);
  const deps = {
    control,
    dataDir,
    clock,
    dropPreview: (projectId: string) => {
      const row = control
        .prepare<{ key: string }>('SELECT key FROM previews WHERE project_id = ?')
        .get(projectId);
      if (row) open.get(row.key)?.close();
      dropPreview(control, dataDir, projectId);
    },
    closeProject: (key: string) => open.get(key)?.close(),
  };
  return { dataDir, control, project, preview, owner, stranger, deps, projectDb };
}

describe('deleteProject', () => {
  it('removes the database, blobs, packs, tile cache, preview and every control row', async () => {
    const w = await world();
    const { key, id } = w.project;
    expect(existsSync(projectDbPath(w.dataDir, key))).toBe(true);
    expect(deleteProject(w.deps, key)).toBe(true);
    expect(existsSync(projectDbPath(w.dataDir, key))).toBe(false);
    expect(existsSync(previewDbPath(w.dataDir, key))).toBe(false);
    for (const dir of [
      join('blobs', key),
      join('blobs', 'packs', key),
      join('blobs', 'tiles', key),
      join('tiles-cache', key),
      join('blobs', w.preview.key),
    ])
      expect(existsSync(join(w.dataDir, dir))).toBe(false);
    expect(readdirSync(w.dataDir).filter((f) => f.includes(key))).toEqual([]);
    const count = (table: string, col = 'project_id'): number =>
      w.control.prepare<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(id)?.n ?? 0;
    for (const t of ['memberships', 'credentials', 'api_tokens', 'sessions', 'previews'])
      expect(count(t)).toBe(0);
    expect(count('projects', 'id')).toBe(0);
    expect(findPreview(w.control, w.preview.key)).toBeUndefined();
  });

  it('is a 404-style false the second time, and the key is never handed out again', async () => {
    const w = await world();
    expect(deleteProject(w.deps, w.project.key)).toBe(true);
    expect(deleteProject(w.deps, w.project.key)).toBe(false);
    const again = createProjectFromTemplate(
      w.control,
      w.projectDb,
      { name: 'Bäume Süd', description: '', template: 'leer@1' },
      w.owner,
      clock,
    );
    expect(again.key).not.toBe(w.project.key);
    expect(() =>
      w.control
        .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
        .run('x', w.project.key, 'x', 'x'),
    ).toThrow(/retired/);
  });
});

describe('the handlers', () => {
  const principal = (id: string, kind: Principal['kind'] = 'admin'): Principal => ({
    kind,
    id,
    projectId: null,
    roles: [],
  });
  async function handlers() {
    const w = await world();
    const h = createProjectDeleteHandlers({
      authorizeProjectDelete: (p, key) => {
        if (p === null) return new Response(null, { status: 401 });
        if (p.kind !== 'admin') return new Response(null, { status: 403 });
        const row = w.control.prepare<{ id: string }>('SELECT id FROM projects WHERE key = ?').get(key);
        if (!row) return new Response(null, { status: 404 });
        const member = w.control
          .prepare('SELECT 1 AS x FROM memberships WHERE account_id = ? AND project_id = ?')
          .get(p.id, row.id);
        return member ? { projectKey: key } : new Response(null, { status: 403 });
      },
      effectiveFile: () => ({ ok: false, code: 'not_published', problems: [] }),
      counts: (key) => deleteCounts(w.projectDb(key), null),
      remove: (key) => deleteProject(w.deps, key),
    });
    const call = (p: Principal | null, body: unknown) => ({
      request: new Request('http://x/', { method: 'DELETE', body: JSON.stringify(body) }),
      params: { key: w.project.key },
      principal: p,
    });
    return { w, h, call };
  }

  it('refuses without the typed key (400), non-members and participants (403)', async () => {
    const { w, h, call } = await handlers();
    expect((await h.DELETE(call(principal(w.owner), { confirm: 'falsch' }))).status).toBe(400);
    expect((await h.DELETE(call(principal(w.owner), {}))).status).toBe(400);
    expect((await h.DELETE(call(principal(w.stranger), { confirm: w.project.key }))).status).toBe(403);
    expect((await h.DELETE(call(principal('anna', 'participant'), { confirm: w.project.key }))).status).toBe(
      403,
    );
    expect((await h.DELETE(call(null, { confirm: w.project.key }))).status).toBe(401);
    expect(existsSync(projectDbPath(w.dataDir, w.project.key))).toBe(true);
  });

  it('deletes with the key (204); a second request is 404', async () => {
    const { w, h, call } = await handlers();
    expect((await h.DELETE(call(principal(w.owner), { confirm: w.project.key }))).status).toBe(204);
    expect((await h.DELETE(call(principal(w.owner), { confirm: w.project.key }))).status).toBe(404);
  });

  it('answers the counts of the confirm dialog', async () => {
    const { w, h, call } = await handlers();
    const r = h.GET(call(principal(w.owner), undefined));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ participants: 1, features: 0 });
  });
});
