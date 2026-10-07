import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import type * as Layout from './+layout.server';
import type * as Page from './+page.server';

// WP-320: the guard and the shell's data, over the REAL runtime (as authz.spec does): no stub of memberships.
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-shell-'));
let layout: typeof Layout;
let page: typeof Page;
let stop: () => void = () => undefined;
let admin: Principal;
let participant: Principal;

type LayoutEvent = Parameters<(typeof Layout)['load']>[0];
const event = (
  path: string,
  principal: Principal | null,
  opts: { cookie?: string; lang?: string } = {},
): LayoutEvent =>
  ({
    url: new URL(path, 'http://localhost'),
    locals: { admin: principal },
    request: new Request('http://localhost' + path, {
      headers: opts.lang === undefined ? {} : { 'accept-language': opts.lang },
    }),
    cookies: { get: (n: string) => (n === 'ub_locale' ? opts.cookie : undefined) },
  }) as unknown as LayoutEvent;

/** What `load` throws or returns, as a plain value. */
async function run(
  e: LayoutEvent,
): Promise<{ status?: number; location?: string; data?: Record<string, unknown> }> {
  try {
    return { data: (await layout.load(e)) as Record<string, unknown> };
  } catch (err) {
    const r = err as { status?: number; location?: string };
    if (typeof r.status === 'number')
      return { status: r.status, ...(r.location ? { location: r.location } : {}) };
    throw err;
  }
}

// The hook imports the whole runtime and hashes a password: about 8 s cold at machine load 45, so it gets
// its own timeout instead of the 10 s default (refused lead-a's land 2026-10-02). Trains with ~30 workers took
// 43–60 s here on 2026-10-03; WP-1003 (icons by deep import) cut the hook to ~8 s at load 33, so 60 s again. WP-1018: the real cost was `participant/messages` (the Paraglide barrel, ~1800 modules) reached through `shell/locale.ts`; now 30 s.
beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['PACK_BUILD'] = '0';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  const { runtime } = await import('../../../lib/server/runtime');
  layout = await import('./+layout.server');
  page = await import('./+page.server');
  const rt = runtime();
  stop = () => rt.stop();
  const names: readonly (readonly [string, string])[] = [
    ['zeta', 'Zeta Stadt'],
    ['alpha', 'Alpha Stadt'],
    ['other', 'Fremdes Projekt'],
  ];
  for (const [key, name] of names)
    rt.control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run(`id-${key}`, key, name, 'x');
  const id = await rt.auth.createAdmin('admin@example.org', 'correct horse battery');
  for (const key of ['zeta', 'alpha'])
    rt.control
      .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
      .run(id, `id-${key}`, 'verwaltung');
  admin = { kind: 'admin', id, projectId: null, roles: [] };
  participant = { kind: 'participant', id: 'pp', projectId: 'id-alpha', roles: [] };
}, 30_000);

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('the guard', () => {
  it('signed out, /admin/projects goes to the login page and keeps where it was going', async () => {
    const r = await run(event('/admin/projects', null));
    expect(r.status).toBe(303);
    const url = new URL(r.location ?? '', 'http://localhost');
    expect(url.pathname).toBe('/admin/login');
    expect(url.searchParams.get('redirectTo')).toBe('/admin/projects');
  });

  it('keeps the query of a deep link', async () => {
    const r = await run(event('/admin/projects/alpha/roles?tab=2', null));
    expect(new URL(r.location ?? '', 'http://localhost').searchParams.get('redirectTo')).toBe(
      '/admin/projects/alpha/roles?tab=2',
    );
  });

  it('the login page itself is open to anonymous visitors', async () => {
    const r = await run(event('/admin/login', null));
    expect(r.status).toBeUndefined();
    expect(r.data).toMatchObject({ account: null, projects: [], currentProject: null });
  });

  it('a participant session is no admin session: sign-in with redirectTo (303), never a 403 (WP-705)', async () => {
    const r = await run(event('/admin/projects', participant));
    expect(r.status).toBe(303);
    expect(r.location).toBe('/admin/login?redirectTo=%2Fadmin%2Fprojects');
  });
});

describe('the shell data', () => {
  it('gives the account e-mail and the projects with a membership, by name', async () => {
    const r = await run(event('/admin/projects', admin));
    expect(r.data).toMatchObject({
      account: { email: 'admin@example.org' },
      projects: [
        { key: 'alpha', name: 'Alpha Stadt' },
        { key: 'zeta', name: 'Zeta Stadt' },
      ],
      currentProject: null,
    });
  });

  it('inside /admin/projects/<key>/… the current project is that project', async () => {
    const r = await run(event('/admin/projects/zeta/participants', admin));
    expect(r.data).toMatchObject({ currentProject: { key: 'zeta', name: 'Zeta Stadt' } });
  });

  it('a project without membership is not the current project (and not listed)', async () => {
    const r = await run(event('/admin/projects/other/roles', admin));
    expect(r.data).toMatchObject({ currentProject: null });
    expect((r.data?.['projects'] as { key: string }[]).map((p) => p.key)).not.toContain('other');
  });

  it('the language is the cookie, else Accept-Language', async () => {
    expect((await run(event('/admin/projects', admin, { cookie: 'en' }))).data?.['locale']).toBe('en');
    expect((await run(event('/admin/projects', admin, { lang: 'en-GB' }))).data?.['locale']).toBe('en');
    expect((await run(event('/admin/projects', admin, { lang: 'de-DE' }))).data?.['locale']).toBe('de');
  });
});

describe('/admin', () => {
  it('goes to /admin/projects', () => {
    expect(() =>
      page.load({ locals: { admin: admin } } as unknown as Parameters<(typeof Page)['load']>[0]),
    ).toThrow(expect.objectContaining({ status: 303, location: '/admin/projects' }));
  });
  it('signed out it goes the same way (the layout guard then sends it to the login page)', () => {
    expect(() =>
      page.load({ locals: { admin: null } } as unknown as Parameters<(typeof Page)['load']>[0]),
    ).toThrow(expect.objectContaining({ status: 303 }));
  });
});
