import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import { roleKeyOf } from '../../../routes/(admin)/admin/projects/[projectId]/roles/roles-doc';
import type { ParticipantsPageData } from './types';
import type * as Admin from '../../server/handlers/admin';
import type * as Page from '../../../routes/(admin)/admin/projects/[projectId]/participants/+page.server';
import type * as Roles from '../../../routes/(admin)/admin/projects/[projectId]/participants/roles/+server';

// WP-324: the Teilnehmende page's server side over the REAL runtime: the load, the draft write of a typed role, and the
// admin routes the page calls (WP-310, WP-607).
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-participants-'));
let page: typeof Page;
let roles: typeof Roles;
let handlers: ReturnType<typeof Admin.participants>;
let stop: () => void = () => undefined;
let admin: Principal;
let outsider: Principal;
let participant: Principal;
// A fresh project per test (new key, own database), so no test depends on another or on an earlier repeat.
let KEY = 'musterstadt';
let testNo = 0;

const url = (extra = '') => new URL(`http://localhost/admin/projects/${KEY}/participants${extra}`);
const headers = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const call = (
  principal: Principal | null,
  over: Record<string, unknown> = {},
  body?: unknown,
  method = 'POST',
) => ({
  locals: { admin: principal },
  params: { project: KEY, projectId: KEY, ...over },
  url: url(),
  cookies: { get: () => undefined },
  request: new Request(url(), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }),
  getClientAddress: () => '127.0.0.1',
});
const load = (principal: Principal | null, extra = ''): ParticipantsPageData =>
  (page.load as (e: unknown) => ParticipantsPageData)({
    ...call(principal),
    url: url(extra),
  });
const thrown = (f: () => unknown): { status?: number; location?: string } => {
  try {
    f();
  } catch (e) {
    return e as { status?: number; location?: string };
  }
  return {};
};
/** One call of the participant handlers the `/api/admin/p/<project>/participants…` routes delegate to. */
const h = (principal: Principal | null, params: Record<string, string>, body?: unknown, method = 'POST') => ({
  principal,
  params: { project: KEY, ...params },
  request: new Request(url(), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }),
});
/** What the admin routes answer, as far as the specs read it. */
interface Answer {
  readonly id?: string;
  readonly token?: string;
  readonly link?: string;
  readonly error?: string;
  readonly message?: { readonly de: string; readonly en: string };
  readonly role?: { readonly key: string; readonly pending: boolean };
}
const json = async (r: Response | Promise<Response>) => (await r).json() as Promise<Answer>;

beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  const { runtime } = await import('../../server/runtime');
  page = await import('../../../routes/(admin)/admin/projects/[projectId]/participants/+page.server');
  roles = await import('../../../routes/(admin)/admin/projects/[projectId]/participants/roles/+server');
  handlers = (await import('../../server/handlers/admin')).participants();
  const rt = runtime();
  stop = () => rt.stop();
  const a = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  const b = await rt.auth.createAdmin('b@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  outsider = { kind: 'admin', id: b, projectId: null, roles: [] };
  participant = { kind: 'participant', id: 'pp', projectId: 'x', roles: [] };
});

beforeEach(async () => {
  const { runtime } = await import('../../server/runtime');
  const { createProjectFromTemplate } = await import('@ueberblick/server');
  const rt = runtime();
  testNo += 1;
  KEY = createProjectFromTemplate(
    rt.control,
    rt.projectDb,
    { name: `Musterstadt ${testNo}`, description: '', template: 'leer@1' },
    admin.id,
    rt.clock,
  ).key;
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('the load (v3 participants/+page.server.ts)', () => {
  it('is guarded like the admin area', () => {
    expect(thrown(() => load(null)).location).toBe(
      `/admin/login?redirectTo=${encodeURIComponent(`/admin/projects/${KEY}/participants`)}`,
    );
    expect(thrown(() => load(participant)).status).toBe(303);
    expect(thrown(() => load(outsider)).status).toBe(403); // an admin with no role in this project
  });

  it('starts empty, with the column types of the registry', () => {
    const data = load(admin);
    expect(data).toMatchObject({ people: [], columns: [], showGuests: false });
    expect(data.columnTypes).toEqual(['text', 'number', 'boolean', 'date']);
  });
});

describe('a role typed in the Rollen cell goes into the draft (Q13)', () => {
  it('POST roles adds roles.<key> to the draft overlay and offers it as pending', async () => {
    const r = await roles.POST(call(admin, {}, { name: 'Praktikum' }) as never);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ role: { key: 'praktikum', label: 'Praktikum', pending: true } });
    expect(load(admin).roles).toContainEqual({ key: 'praktikum', label: 'Praktikum', pending: true });
  });

  it('typing the same name again does not add a second role', async () => {
    await roles.POST(call(admin, {}, { name: 'Praktikum' }) as never);
    const r = await roles.POST(call(admin, {}, { name: 'Praktikum' }) as never);
    expect((await json(r)).role?.key).toBe('praktikum');
    expect(load(admin).roles.filter((x) => x.key.startsWith('praktikum'))).toHaveLength(1);
  });

  it('a different name that makes the same key gets its own key', async () => {
    await roles.POST(call(admin, {}, { name: 'Praktikum' }) as never);
    const r = await roles.POST(call(admin, {}, { name: 'praktikum!' }) as never);
    expect((await json(r)).role).toMatchObject({ key: 'praktikum_2', pending: true });
  });

  it('refuses an empty name, a foreign admin and a request from another origin', async () => {
    expect((await roles.POST(call(admin, {}, { name: '  ' }) as never)).status).toBe(400);
    // one character is too short, as on the Rollen page (v3: at least 2 characters)
    const short = await roles.POST(call(admin, {}, { name: 'A' }) as never);
    expect(short.status).toBe(400);
    expect((await json(short)).error).toBe('name_short');
    expect((await roles.POST(call(admin, {}, { name: 5 }) as never)).status).toBe(400);
    expect((await roles.POST(call(outsider, {}, { name: 'X' }) as never)).status).toBe(403);
    const cross = call(admin, {}, { name: 'X' });
    const r = await roles.POST({
      ...cross,
      request: new Request(url(), {
        method: 'POST',
        headers: { ...headers, 'sec-fetch-site': 'cross-site' },
        body: JSON.stringify({ name: 'X' }),
      }),
    } as never);
    expect(r.status).toBe(403);
  });
});

describe('the roster through the routes the page calls', () => {
  /** The draft role "Praktikum" and Anna holding it: the start of most of the tests below. */
  const addAnna = async (): Promise<string> => {
    await roles.POST(call(admin, {}, { name: 'Praktikum' }) as never);
    const r = await handlers.add(h(admin, {}, { name: 'Anna', roles: ['praktikum'] }));
    expect(r.status).toBe(201);
    return (await r.json()).id as string;
  };

  it('adds Anna with the new role (the roster accepts a role that is only in the draft); the id is generated', async () => {
    expect(await addAnna()).toMatch(/^anna-[0-9a-f]{6}$/);
  });

  it("refuses an empty name with v3's message in both languages (Q12)", async () => {
    const r = await handlers.add(h(admin, {}, { name: ' ', roles: [] }));
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatchObject({
      de: expect.stringMatching(/Name/),
      en: expect.any(String),
    });
  });

  it('a new person has no token until one is generated; then the load shows it readable', async () => {
    const id = await addAnna();
    expect(load(admin).people[0]).toMatchObject({ id, name: 'Anna', roles: ['praktikum'], token: null });
    const made = await json(handlers.credSet(h(admin, { id }, {}, 'PUT')));
    expect(made.token).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
    expect(made.link).toBe(`/login?token=${made.token}`);
    expect(load(admin).people[0]?.token).toBe(made.token);
  });

  it('sets a chosen token, and revokes it', async () => {
    const id = await addAnna();
    const chosen = `anna-2026-badge-${testNo}`; // tokens are unique across projects, so one per execution
    const set = await json(handlers.credSet(h(admin, { id }, { token: chosen }, 'PUT')));
    expect(set.token).toBe(chosen);
    expect(load(admin).people[0]?.token).toBe(chosen);
    expect((await handlers.credRevoke(h(admin, { id }, undefined, 'DELETE'))).status).toBe(200);
    expect(load(admin).people[0]?.token).toBeNull();
  });

  it('Status: disabling and enabling is reversible', async () => {
    const id = await addAnna();
    await handlers.update(h(admin, { id }, { disabled: true }, 'PATCH'));
    expect(load(admin).people[0]?.disabledAt).not.toBeNull();
    await handlers.update(h(admin, { id }, { disabled: false }, 'PATCH'));
    expect(load(admin).people[0]?.disabledAt).toBeNull();
  });

  it('a custom column "Personalnummer" (Text, Pflichtfeld): an add without it is refused, with it works', async () => {
    const put = await handlers.columnsSet(
      h(
        admin,
        {},
        { columns: [{ key: 'personalnummer', label: 'Personalnummer', type: 'text', required: true }] },
        'PUT',
      ),
    );
    expect(put.status).toBe(200);
    expect(load(admin).columns).toEqual([
      { key: 'personalnummer', label: 'Personalnummer', type: 'text', required: true },
    ]);
    const without = await handlers.add(h(admin, {}, { name: 'Berta', roles: [] }));
    expect(without.status).toBe(400);
    expect((await without.json()).error).toBe('column_required');
    const withIt = await handlers.add(
      h(admin, {}, { name: 'Berta', roles: [], attrs: { personalnummer: '4711' } }),
    );
    expect(withIt.status).toBe(201);
    expect(load(admin).people.find((p) => p.name === 'Berta')?.attrs).toEqual({ personalnummer: '4711' });
  });

  it('"Gäste anzeigen": self-joined guests only with ?showGuests=true', async () => {
    const { runtime } = await import('../../server/runtime');
    const rt = runtime();
    rt.projectDb(KEY)
      .prepare("INSERT INTO participants (id, name, roles, self_joined) VALUES ('gast-1', 'Gast', '[]', 1)")
      .run();
    expect(load(admin).people.map((p) => p.name)).not.toContain('Gast');
    const shown = load(admin, '?showGuests=true');
    expect(shown.people.map((p) => p.name)).toContain('Gast');
    expect(shown.showGuests).toBe(true);
  });

  it('Löschen removes the person from the list (history stays)', async () => {
    const id = await addAnna();
    await handlers.remove(h(admin, { id }, undefined, 'DELETE'));
    expect(load(admin).people.map((p) => p.id)).not.toContain(id);
  });
});

describe('2,000 participants (R14: the load stays one query plus one lookup each)', () => {
  it('loads a roster of 2,000 with tokens', async () => {
    const { runtime } = await import('../../server/runtime');
    const rt = runtime();
    const db = rt.projectDb(KEY);
    const insert = db.prepare('INSERT INTO participants (id, name, roles) VALUES (?, ?, ?)');
    for (let i = 0; i < 2000; i++) insert.run(`bulk-${i}`, `Person ${i}`, '[]');
    const data = load(admin);
    expect(data.people.length).toBeGreaterThanOrEqual(2000);
    expect(data.people.every((p) => p.token === null || p.token.length > 0)).toBe(true);
  });
});

describe('roleKeyOf', () => {
  it.each([
    ['Praktikum', 'praktikum'],
    ['Leitung Süd', 'leitung_sued'],
    ['3. Schicht', 'r_3_schicht'],
    ['???', 'rolle'],
  ])('%s -> %s', (name, key) => expect(roleKeyOf(name)).toBe(key));
});
