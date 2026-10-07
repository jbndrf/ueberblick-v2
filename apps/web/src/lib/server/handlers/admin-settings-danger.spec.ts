import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProjectFromTemplate,
  readApiToken,
  readSessionCookie,
  type Principal,
} from '@ueberblick/server';
import type { Call } from './http';
import type * as Tokens from './admin-tokens';
import type * as Danger from './admin-project-delete';
import type * as Runtime from '../runtime';

// The REAL handlers over the real runtime (WP-388): API tokens and project delete.
const dir = mkdtempSync(join(tmpdir(), 'ub-danger-'));
let tokens: (typeof Tokens)['adminTokensHandlers'];
let danger: (typeof Danger)['adminProjectDeleteHandlers'];
let stop: () => void = () => undefined;
let admin: Principal;
let stranger: Principal;
let participant: Principal;
let rt: ReturnType<(typeof Runtime)['runtime']>;
let adminId = '';
let key = '';
let id = '';

beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  rt = (await import('../runtime')).runtime();
  tokens = (await import('./admin-tokens')).adminTokensHandlers;
  danger = (await import('./admin-project-delete')).adminProjectDeleteHandlers;
  stop = () => rt.stop();
  const a = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  adminId = a;
  const b = await rt.auth.createAdmin('b@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  stranger = { kind: 'admin', id: b, projectId: null, roles: [] };
  participant = { kind: 'participant', id: 'anna', projectId: 'x', roles: [] };
  ({ key, id } = createProjectFromTemplate(
    rt.control,
    rt.projectDb,
    { name: 'Danger Test', description: '', template: 'leer@1' },
    a,
    rt.clock,
  ));
  rt.projectDb(key)
    .prepare("INSERT INTO participants (id, name, roles, attrs) VALUES ('anna','Anna','[]', NULL)")
    .run();
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

const call = (
  principal: Principal | null,
  method: string,
  params: Record<string, string>,
  body?: unknown,
  sameOrigin = true,
): Call =>
  ({
    locals: { admin: principal },
    params,
    request: new Request('http://localhost:3000/x', {
      method,
      headers: sameOrigin ? { 'sec-fetch-site': 'same-origin' } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    getClientAddress: () => '127.0.0.1',
  }) as unknown as Call;

describe('API tokens endpoint', () => {
  it('creates a token (secret once), lists it without the secret, authenticates, revokes', async () => {
    const created = await tokens.POST(
      call(admin, 'POST', { project: key }, { participant: 'anna', label: 'Laptop' }),
    );
    expect(created.status).toBe(201);
    const { token, info } = (await created.json()) as { token: string; info: { id: string } };
    expect(token).toMatch(/^ubk_/);

    const listed = await tokens.GET(call(admin, 'GET', { project: key }));
    const text = await listed.text();
    expect(text).toContain('Laptop');
    expect(text).not.toContain(token);

    const req = new Request('http://localhost:3000/api/p/x/ogc', {
      headers: { authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` },
    });
    expect(rt.auth.authenticate(readSessionCookie(req, 'participant'))).toMatchObject({
      id: 'anna',
      projectId: id,
    });

    expect(tokens.DELETE(call(admin, 'DELETE', { project: key, id: info.id })).status).toBe(204);
    expect(rt.auth.authenticate(readSessionCookie(req, 'participant'))).toBeNull();
    expect(tokens.DELETE(call(admin, 'DELETE', { project: key, id: info.id })).status).toBe(404);
  });

  it('creates an admin token (WP-1070): bound to the calling admin, listed as admin, refuses both owners at once', async () => {
    const created = await tokens.POST(
      call(admin, 'POST', { project: key }, { admin: true, label: 'QGIS Admin' }),
    );
    expect(created.status).toBe(201);
    const { token, info } = (await created.json()) as {
      token: string;
      info: { id: string; participantId: string | null; adminId: string; adminEmail: string };
    };
    expect(info.participantId).toBeNull();
    expect(info.adminId).toBe(admin.id);
    const req = new Request('http://localhost:3000/x', { headers: { authorization: `Bearer ${token}` } });
    expect(rt.auth.authenticate(readApiToken(req))).toMatchObject({
      kind: 'admin',
      id: admin.id,
      projectId: id,
    });
    const both = { admin: true, participant: 'anna', label: 'x' };
    expect((await tokens.POST(call(admin, 'POST', { project: key }, both))).status).toBe(400);
    expect(tokens.DELETE(call(admin, 'DELETE', { project: key, id: info.id })).status).toBe(204);
    expect(rt.auth.authenticate(readApiToken(req))).toBeNull();
  });

  it('refuses non-members, participants, anonymous callers and cross-origin changes', async () => {
    const body = { participant: 'anna', label: 'x' };
    expect((await tokens.POST(call(stranger, 'POST', { project: key }, body))).status).toBe(403);
    expect((await tokens.POST(call(participant, 'POST', { project: key }, body))).status).toBe(403);
    expect((await tokens.POST(call(null, 'POST', { project: key }, body))).status).toBe(401);
    expect((await tokens.POST(call(admin, 'POST', { project: key }, body, false))).status).toBe(403);
  });

  it('refuses a bad body, an unknown participant and a past expiry with 400', async () => {
    const post = (b: unknown) => tokens.POST(call(admin, 'POST', { project: key }, b));
    expect((await post({ label: 'x' })).status).toBe(400);
    expect((await post({ participant: 'nobody', label: 'x' })).status).toBe(400);
    expect((await post({ participant: 'anna', label: ' ' })).status).toBe(400);
    expect((await post({ participant: 'anna', label: 'x', expiresAt: '2001-01-01T00:00:00Z' })).status).toBe(
      400,
    );
  });
});

describe('project delete endpoint', () => {
  it('counts first, refuses a wrong key (400), non-members (403) and participants (403)', async () => {
    const counts = danger.GET(call(admin, 'GET', { key }));
    expect(counts.status).toBe(200);
    expect(await counts.json()).toMatchObject({ participants: 1, features: 0 });
    const del = (p: Principal | null, confirm: string) =>
      danger.DELETE(call(p, 'DELETE', { key }, { confirm }));
    expect((await del(admin, 'wrong')).status).toBe(400);
    expect((await del(stranger, key)).status).toBe(403);
    expect((await del(participant, key)).status).toBe(403);
    expect((await danger.DELETE(call(admin, 'DELETE', { key }, { confirm: key }, false))).status).toBe(403);
    expect(existsSync(join(dir, `project-${key}.db`))).toBe(true);
  });

  it('deletes everything with the typed key; a second request is 404', async () => {
    // its own project, so a repeat of the test creates another one
    const own = createProjectFromTemplate(
      rt.control,
      rt.projectDb,
      { name: `Delete Me ${crypto.randomUUID().slice(0, 8)}`, description: '', template: 'leer@1' },
      adminId,
      rt.clock,
    ).key;
    const del = () => danger.DELETE(call(admin, 'DELETE', { key: own }, { confirm: own }));
    expect(existsSync(join(dir, `project-${own}.db`))).toBe(true);
    expect((await del()).status).toBe(204);
    expect(existsSync(join(dir, `project-${own}.db`))).toBe(false);
    expect(rt.project(own)).toBeUndefined();
    expect((await del()).status).toBe(404);
  });
});
