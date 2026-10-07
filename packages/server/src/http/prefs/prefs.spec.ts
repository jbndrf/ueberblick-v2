import { describe, expect, it } from 'vitest';
import { SESSION_PARTICIPANT_HEADER, type Key } from '@ueberblick/core';
import { createAuth, isAuthError, type Auth } from '../../auth';
import { openControlDb, openProjectDb } from '../../db/open';
import { createPrefsStore } from '../../prefs';
import { createPrefsHandlers } from './handlers';

const NOW = '2026-10-01T08:00:00.000Z';
const T = (s: number): string => `2026-10-01T08:00:${String(s).padStart(2, '0')}.000Z`;

async function world() {
  const control = openControlDb(':memory:');
  for (const [id, key] of [
    ['p1', 'trees'],
    ['p2', 'other'],
  ] as const)
    control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run(id, key, key, 'x');
  const auth: Auth = createAuth({
    control,
    now: () => new Date(NOW),
    participantRoles: () => ['melder' as Key],
  });
  const session = (projectId: string, who: string): string => {
    const s = auth.exchange(auth.issueCredential(projectId, who).token);
    if (isAuthError(s)) throw new Error(s.code);
    return `ub_session_participant=${s.id}`;
  };
  const adminId = await auth.createAdmin('a@example.org', 'correct horse battery');
  control
    .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
    .run(adminId, 'p1', 'verwaltung');
  const db = openProjectDb(':memory:', 'trees');
  const handlers = createPrefsHandlers({
    auth,
    project: (key) =>
      control.prepare<{ id: string; key: string }>('SELECT id, key FROM projects WHERE key = ?').get(key),
    clock: { now: () => NOW },
    projectDb: () => db,
  });
  const cookies = {
    mia: session('p1', 'mia'),
    bernd: session('p1', 'bernd'),
    zoe: session('p2', 'zoe'),
    admin: `ub_session_admin=${auth.openAdminSession(adminId).id}`,
  };
  const call = (
    method: 'get' | 'patch' | 'remove',
    o: { cookie?: string; body?: unknown; project?: string; query?: string; as?: string } = {},
  ) =>
    handlers[method](
      new Request(`http://x/api/p/${o.project ?? 'trees'}/prefs${o.query ?? ''}`, {
        method: method === 'remove' ? 'DELETE' : method.toUpperCase(),
        headers: {
          ...(o.cookie ? { cookie: o.cookie } : {}),
          ...(o.as ? { [SESSION_PARTICIPANT_HEADER]: o.as } : {}),
          'content-type': 'application/json',
        },
        ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
      }),
      { params: { project: o.project ?? 'trees' } },
    );
  return { call, cookies, db };
}

const edit = (path: string, value: unknown, at = T(1)) => ({ entries: [{ path, value, at }] });
interface Reply {
  entries: Record<string, { value: unknown; at: string }>;
  prefs: { tools: Record<string, boolean>; ui: Record<string, string>; [k: string]: unknown };
}
const json = async (r: Response) => (await r.json()) as Reply;

describe('GET and PATCH', () => {
  it("a new device receives the record (GET) with the person's keys, nobody else's", async () => {
    const w = await world();
    expect((await w.call('patch', { cookie: w.cookies.mia, body: edit('ui.theme', 'dark') })).status).toBe(
      200,
    );
    await w.call('patch', { cookie: w.cookies.bernd, body: edit('ui.theme', 'light') });
    const got = await json(await w.call('get', { cookie: w.cookies.mia }));
    expect(got.prefs.ui.theme).toBe('dark');
    expect(got.entries['ui.theme']).toEqual({ value: 'dark', at: T(1) });
    const fresh = await json(await w.call('get', { cookie: w.cookies.zoe, project: 'other' }));
    expect(fresh.prefs).toEqual({
      tools: {},
      tool_prefs: {},
      filters: { saved: [], active: null, hidden: null },
      ui: {},
    });
  });

  it('two devices change different keys: both survive; the same key: the later time wins', async () => {
    const w = await world();
    await w.call('patch', { cookie: w.cookies.mia, body: edit('tools.chat', true, T(5)) });
    await w.call('patch', { cookie: w.cookies.mia, body: edit('ui.locale', 'de', T(6)) });
    await w.call('patch', { cookie: w.cookies.mia, body: edit('ui.theme', 'dark', T(9)) });
    const late = await json(
      await w.call('patch', { cookie: w.cookies.mia, body: edit('ui.theme', 'light', T(3)) }),
    );
    expect(late.prefs.ui).toEqual({ locale: 'de', theme: 'dark' });
    expect(late.prefs.tools).toEqual({ chat: true });
  });

  it('refuses unknown keys, wrong types and bad times; nothing is written', async () => {
    const w = await world();
    const bad = [
      edit('colour', 'red'),
      edit('tools.chat', 'yes'),
      edit('ui.theme', 'purple'),
      edit('ui.theme', 'dark', 'yesterday'),
      {
        entries: [
          { path: 'ui.theme', value: 'dark', at: T(1) },
          { path: 'nope', value: 1, at: T(1) },
        ],
      },
      { entries: [], extra: 1 },
    ];
    for (const body of bad) {
      const r = await w.call('patch', { cookie: w.cookies.mia, body });
      expect(r.status).toBe(400);
    }
    const got = await json(await w.call('get', { cookie: w.cookies.mia }));
    expect(got.entries).toEqual({});
  });

  it('cuts a time far in the future back, so a wrong clock cannot pin a key', async () => {
    const w = await world();
    await w.call('patch', {
      cookie: w.cookies.mia,
      body: edit('ui.theme', 'dark', '2099-01-01T00:00:00.000Z'),
    });
    const got = await json(await w.call('get', { cookie: w.cookies.mia }));
    expect(got.entries['ui.theme']?.at).toBe('2026-10-01T08:05:00.000Z');
  });

  it('401 without a session, 403 for another project', async () => {
    const w = await world();
    expect((await w.call('get')).status).toBe(401);
    expect((await w.call('get', { cookie: w.cookies.zoe })).status).toBe(403);
    expect((await w.call('patch', { cookie: w.cookies.zoe, body: edit('ui.theme', 'dark') })).status).toBe(
      403,
    );
  });
});

describe('admin reset', () => {
  it('clears the record of a person; a participant may not', async () => {
    const w = await world();
    await w.call('patch', { cookie: w.cookies.mia, body: edit('ui.theme', 'dark') });
    expect((await w.call('remove', { cookie: w.cookies.mia, query: '?participant=mia' })).status).toBe(403);
    expect((await w.call('remove', { cookie: w.cookies.admin })).status).toBe(400);
    expect((await w.call('remove', { cookie: w.cookies.admin, query: '?participant=mia' })).status).toBe(204);
    const got = await json(await w.call('get', { cookie: w.cookies.mia }));
    expect(got.entries).toEqual({});
    expect(w.db.prepare('SELECT count(*) AS n FROM prefs').get()).toEqual({ n: 0 });
  });
});

describe('store', () => {
  it('remove deletes the row (erasure)', () => {
    const db = openProjectDb(':memory:', 'trees');
    const store = createPrefsStore(db, { now: () => NOW });
    store.patch('p', [{ path: 'tools.chat', value: true, at: T(1) }]);
    expect(store.remove('p')).toBe(true);
    expect(store.get('p')).toEqual({});
    expect(store.remove('p')).toBe(false);
  });
});

describe('preferences under a turned session (WP-768)', () => {
  it('a PATCH made as another participant is a 409 and writes nothing; the reply names the session', async () => {
    const w = await world();
    const body = { entries: [{ path: 'ui.offline_images', value: true, at: T(1) }] };
    const r = await w.call('patch', { cookie: w.cookies.bernd, as: 'olga', body });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'session_changed' });
    const read = await (await w.call('get', { cookie: w.cookies.bernd })).json();
    expect(read).toMatchObject({ entries: {} });
    const ok = await w.call('get', { cookie: w.cookies.mia, as: 'mia' });
    expect(ok.headers.get(SESSION_PARTICIPANT_HEADER)).toBe('mia');
  });
});
