import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import type { RolesPageData } from '../../../../../../lib/admin/roles/types';

// WP-346: the Rollen page's server side over the REAL runtime: the load, the draft edits (Doc ops) and the members route.
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-roles-'));
let stop: () => void = () => undefined;
let status: () => { dirty: boolean; neverPublished: boolean };
let overlayOf: () => string;
let publish: () => void;
let admin: Principal;
let outsider: Principal;
let participant: Principal;
let KEY = 'musterstadt';
let testNo = 0;

const url = () => new URL(`http://localhost/admin/projects/${KEY}/roles`);
const headers = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const call = (
  principal: Principal | null,
  body?: unknown,
  method = 'POST',
  extra: Record<string, string> = {},
) => ({
  locals: { admin: principal },
  params: { project: KEY, projectId: KEY },
  url: url(),
  cookies: { get: () => undefined },
  request: new Request(url(), {
    method,
    headers: { ...headers, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }),
});
const load = (principal: Principal | null): RolesPageData =>
  (page.load as (e: unknown) => RolesPageData)(call(principal));
const thrown = (f: () => unknown): { status?: number; location?: string } => {
  try {
    f();
  } catch (e) {
    return e as { status?: number; location?: string };
  }
  return {};
};
interface Answer {
  readonly key?: string;
  readonly error?: string;
  readonly message?: { readonly de: string; readonly en: string };
  readonly uses?: readonly { path: string; message: string }[];
  readonly people?: readonly { id: string; name: string }[];
}
const post = async (body: unknown, principal: Principal | null = admin) => {
  const r = await roles.POST(call(principal, body) as never);
  return { status: r.status, body: (await r.json()) as Answer };
};
const put = async (body: unknown, principal: Principal | null = admin) =>
  (await members.PUT(call(principal, body, 'PUT') as never)).status;

// The first import of the builder package (the Doc model) is the slow part under load (about 20 s cold), so the modules
// are imported here, at the top of the file, and the hooks only set the runtime up.
process.env['PUBLIC_URL'] = 'http://localhost:3000';
process.env['DATA_DIR'] = dir;
process.env['TIMERS_INTERVAL_S'] = '0';
const { runtime } = await import('../../../../../../lib/server/runtime');
const { draftStatus, createDraftStore, createProjectFromTemplate, deploy } =
  await import('@ueberblick/server');
const { parse } = await import('yaml');
const { joinAsGuest, listParticipants, resolveSlug } = await import('@ueberblick/server');
const page = await import('./+page.server');
const roles = await import('./+server');
const members = await import('./members/+server');
const joinRoute = await import('./join/+server');
const handlers = (await import('../../../../../../lib/server/handlers/admin')).participants();

beforeAll(async () => {
  const rt = runtime();
  stop = () => rt.stop();
  status = () => draftStatus(rt.projectDb(KEY), { clock: rt.clock, templates: rt.templates });
  publish = () => {
    const done = deploy(rt.projectDb(KEY), parse(overlayOf()), admin.id, {
      clock: rt.clock,
      templates: rt.templates,
    });
    if (!done.ok) throw new Error(JSON.stringify(done.problems));
  };
  overlayOf = () => createDraftStore(rt.projectDb(KEY)).get()?.overlay ?? '';
  const a = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  const b = await rt.auth.createAdmin('b@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  outsider = { kind: 'admin', id: b, projectId: null, roles: [] };
  participant = { kind: 'participant', id: 'pp', projectId: 'x', roles: [] };
});

beforeEach(async () => {
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

describe('the load (v3 roles/+page.server.ts)', () => {
  it('is guarded like the admin area', () => {
    expect(thrown(() => load(null)).location).toBe(
      `/admin/login?redirectTo=${encodeURIComponent(`/admin/projects/${KEY}/roles`)}`,
    );
    expect(thrown(() => load(participant)).status).toBe(303);
    expect(thrown(() => load(outsider)).status).toBe(403);
  });
});

describe('create, rename and describe are Doc ops on the draft', () => {
  it('create puts the role (name and description) into the draft overlay and the publish bar counts it', async () => {
    await post({ action: 'create', name: 'Vorlage' }); // the draft exists ...
    publish(); // ... and is live, so the next edit is the only difference
    expect(status().dirty).toBe(false);
    const r = await post({ action: 'create', name: 'Gutachter', description: 'Prüft Meldungen' });
    expect(r).toMatchObject({ status: 201, body: { key: 'gutachter' } });
    expect(overlayOf()).toContain('roles.gutachter');
    expect(overlayOf()).toContain('Prüft Meldungen');
    expect(status().dirty).toBe(true);
    expect(load(admin).roles).toContainEqual({
      key: 'gutachter',
      label: 'Gutachter',
      description: 'Prüft Meldungen',
      members: [],
      selfJoin: null,
      quota: 0,
      home: '',
    });
  });

  it('rename and description keep the key', async () => {
    await post({ action: 'create', name: 'Gutachter' });
    const r = await post({ action: 'update', key: 'gutachter', name: 'Gutachterin', description: 'neu' });
    expect(r).toMatchObject({ status: 200, body: { key: 'gutachter' } });
    expect(load(admin).roles).toContainEqual({
      key: 'gutachter',
      label: 'Gutachterin',
      description: 'neu',
      members: [],
      selfJoin: null,
      quota: 0,
      home: '',
    });
  });

  it('refuses a short name in both languages, an unknown role, a foreign admin and another origin', async () => {
    const short = await post({ action: 'create', name: 'A' });
    expect(short.status).toBe(400);
    expect(short.body.message).toEqual({
      de: 'Der Name muss mindestens 2 Zeichen lang sein',
      en: 'The name must be at least 2 characters',
    });
    expect((await post({ action: 'update', key: 'nix', name: 'Nix' })).status).toBe(400);
    expect((await post({ action: 'create', name: 'Gutachter' }, outsider)).status).toBe(403);
    expect((await post({ action: 'frob' })).status).toBe(400);
    const cross = await roles.POST(
      call(admin, { action: 'create', name: 'Gutachter' }, 'POST', {
        'sec-fetch-site': 'cross-site',
      }) as never,
    );
    expect(cross.status).toBe(403);
  });
});

describe('delete asks first and removes the role from the draft', () => {
  it('"uses" changes nothing and names the people who have the role; "delete" drops it', async () => {
    await post({ action: 'create', name: 'Gutachter' });
    const added = await handlers.add({
      principal: admin,
      params: { project: KEY },
      request: new Request(url(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Anna', roles: ['gutachter'] }),
      }),
    });
    expect(added.status).toBe(201);
    const before = overlayOf();
    const preview = await post({ action: 'uses', keys: ['gutachter'] });
    expect(preview.status).toBe(200);
    expect(preview.body.people?.map((p) => p.name)).toEqual(['Anna']);
    expect(preview.body.uses).toEqual([]);
    expect(overlayOf()).toBe(before);
    expect((await post({ action: 'delete', keys: ['gutachter'] })).status).toBe(200);
    expect(load(admin).roles.some((r) => r.key === 'gutachter')).toBe(false);
  });

  it('refuses an unknown role', async () => {
    expect((await post({ action: 'delete', keys: ['nix'] })).status).toBe(400);
  });
});

describe('"Teilnehmende bearbeiten": the members route', () => {
  const addPerson = async (name: string): Promise<string> => {
    const r = await handlers.add({
      principal: admin,
      params: { project: KEY },
      request: new Request(url(), { method: 'POST', headers, body: JSON.stringify({ name, roles: [] }) }),
    });
    return ((await r.json()) as { id: string }).id;
  };

  it('adds and removes people of one role in one request, and the load shows the members', async () => {
    await post({ action: 'create', name: 'Gutachter' });
    const anna = await addPerson('Anna');
    const bernd = await addPerson('Bernd');
    expect(await put({ role: 'gutachter', add: [anna, bernd], remove: [] })).toBe(200);
    expect(
      load(admin)
        .roles.find((r) => r.key === 'gutachter')
        ?.members.toSorted(),
    ).toEqual([anna, bernd].toSorted());
    expect(await put({ role: 'gutachter', add: [], remove: [bernd] })).toBe(200);
    expect(load(admin).roles.find((r) => r.key === 'gutachter')?.members).toEqual([anna]);
    expect(
      load(admin)
        .people.map((p) => p.name)
        .sort(),
    ).toEqual(['Anna', 'Bernd']);
  });

  it('WP-488: the first load after a rename and a person typed into the picker already counts the member', async () => {
    // The e2e journey of roles.spec.ts in server calls, on a project whose first request this is (a cold server):
    // create, rename (the key stays), create the person, give them the role, load exactly as `invalidateAll` does.
    const made = await post({ action: 'create', name: 'Gutachter phone' });
    const key = made.body.key ?? '';
    expect((await post({ action: 'update', key, name: 'Gutachterin phone' })).status).toBe(200);
    const dora = await addPerson('Dora phone');
    expect(load(admin).roles.find((r) => r.key === key)?.members).toEqual([]);
    expect(await put({ role: key, add: [dora], remove: [] })).toBe(200);
    const row = load(admin).roles.find((r) => r.key === key);
    expect(row?.label).toBe('Gutachterin phone');
    expect(row?.members).toEqual([dora]);
    // The delete preview (a second read path) names the same person.
    const uses = await post({ action: 'uses', keys: [key] });
    expect(uses.body.people?.map((p) => p.id)).toEqual([dora]);
  });

  it('refuses an unknown role or person, a malformed body and a foreign admin', async () => {
    const anna = await addPerson('Anna');
    expect(await put({ role: 'nix', add: [anna], remove: [] })).toBe(400);
    await post({ action: 'create', name: 'Gutachter' });
    expect(await put({ role: 'gutachter', add: ['ghost'], remove: [] })).toBe(400);
    expect(await put({ role: 'gutachter', add: 'anna', remove: [] })).toBe(400);
    expect(await put({ role: 'gutachter', add: [anna], remove: [] }, outsider)).toBe(403);
  });
});

// WP-367: v3's Selbstbeitritt switch and the quota of the join dialog.
const joinPut = async (
  body: unknown,
  principal: Principal | null = admin,
  extra: Record<string, string> = {},
) => {
  const r = await joinRoute.PUT(call(principal, body, 'PUT', extra) as never);
  return { status: r.status, body: (await r.json()) as { enabled?: boolean; slug?: string; error?: string } };
};

describe('the Selbstbeitritt switch (join links over WP-639)', () => {
  it('on creates the link at once, off disables it, on again keeps the slug; the project file is untouched', async () => {
    await post({ action: 'create', name: 'Gutachter' });
    const before = overlayOf();
    const on = await joinPut({ role: 'gutachter', enabled: true });
    expect(on).toMatchObject({ status: 200, body: { enabled: true } });
    const slug = on.body.slug as string;
    expect(slug).toMatch(/^[a-z0-9-]{3,64}$/);
    expect(resolveSlug(runtime().control, slug)).toMatchObject({ projectKey: KEY, role: 'gutachter' });
    expect(load(admin).roles.find((r) => r.key === 'gutachter')?.selfJoin).toEqual({ enabled: true, slug });
    const off = await joinPut({ role: 'gutachter', enabled: false });
    expect(off.body).toMatchObject({ enabled: false, slug });
    expect(resolveSlug(runtime().control, slug)).toBeUndefined();
    expect(load(admin).roles.find((r) => r.key === 'gutachter')?.selfJoin).toEqual({ enabled: false, slug });
    expect((await joinPut({ role: 'gutachter', enabled: true })).body.slug).toBe(slug);
    expect(overlayOf()).toBe(before);
  });

  it('a request to /join/<slug> opens a guest session with that role, and refuses once switched off', async () => {
    await post({ action: 'create', name: 'Gutachter' });
    const { slug } = (await joinPut({ role: 'gutachter', enabled: true })).body;
    const rt = runtime();
    const deps = {
      control: rt.control,
      projectDb: rt.projectDb,
      auth: rt.auth,
      now: () => new Date(rt.clock.now()),
    };
    const guest = joinAsGuest(deps, slug as string, null);
    expect(guest).toMatchObject({ ok: true, kind: 'created' });
    expect(
      listParticipants({ db: rt.projectDb(KEY) }, { guests: true }).some((p) =>
        (p.roles as readonly string[]).includes('gutachter'),
      ),
    ).toBe(true);
    await joinPut({ role: 'gutachter', enabled: false });
    expect(joinAsGuest(deps, slug as string, null)).toMatchObject({ ok: false, code: 'link_unknown' });
  });

  it('is admin-only and project-scoped: 401, 403, 404, bad body 400, unknown role 400, other origin 403', async () => {
    await post({ action: 'create', name: 'Gutachter' });
    expect((await joinPut({ role: 'gutachter', enabled: true }, null)).status).toBe(401);
    expect((await joinPut({ role: 'gutachter', enabled: true }, participant)).status).toBe(403);
    expect((await joinPut({ role: 'gutachter', enabled: true }, outsider)).status).toBe(403);
    expect((await joinPut({ role: 'nix', enabled: true })).status).toBe(400);
    expect((await joinPut({ role: 'gutachter' })).status).toBe(400);
    expect(
      (await joinPut({ role: 'gutachter', enabled: true }, admin, { 'sec-fetch-site': 'cross-site' })).status,
    ).toBe(403);
    const gone = await joinRoute.PUT({
      ...call(admin, { role: 'gutachter', enabled: true }, 'PUT'),
      params: { projectId: 'gibt-es-nicht' },
    } as never);
    expect(gone.status).toBe(404);
  });
});

describe('the quota (config: roles.<r>.quota, through the draft)', () => {
  it('5 writes the key into the draft, 0 removes it, a bad number is refused in both languages', async () => {
    await post({ action: 'create', name: 'Gutachter' });
    expect((await post({ action: 'quota', key: 'gutachter', quota: 5 })).status).toBe(200);
    expect(load(admin).roles.find((r) => r.key === 'gutachter')?.quota).toBe(5);
    expect(status().dirty).toBe(true);
    expect((await post({ action: 'quota', key: 'gutachter', quota: 0 })).status).toBe(200);
    expect(load(admin).roles.find((r) => r.key === 'gutachter')?.quota).toBe(0);
    const bad = await post({ action: 'quota', key: 'gutachter', quota: -2 });
    expect(bad.status).toBe(400);
    expect(bad.body.message?.de).toBe('Kontingent muss eine nicht-negative Ganzzahl sein');
    expect(bad.body.message?.en).toBe('Quota must be a non-negative whole number');
  });

  it('after publishing, the deployed file carries roles.<r>.quota that the server plan enforces (quota_exceeded: join/quota.spec.ts)', async () => {
    await post({ action: 'create', name: 'Gutachter' });
    await post({ action: 'quota', key: 'gutachter', quota: 5 });
    publish();
    const rt = runtime();
    const compiled = rt
      .projectDb(KEY)
      .prepare<{ compiled: string }>("SELECT compiled FROM config_versions WHERE status = 'deployed'")
      .get();
    const file = (
      JSON.parse(compiled?.compiled ?? '{}') as { file?: { roles?: Record<string, { quota?: number }> } }
    ).file;
    expect(file?.roles?.['gutachter']?.quota).toBe(5);
  });
});
