import { describe, expect, it } from 'vitest';
import { goldenConfig } from '@ueberblick/core/testing';
import { hydrate, type CompiledConfigData } from '@ueberblick/core/hydrate';
import { accessOf, type Principal } from '@ueberblick/server';
import type { ConfigVersionStatus } from '@ueberblick/core/registry';
import { decodeBootstrap } from '../../../lib/participant/decode';
import { createParticipantApi, type ParticipantApiDeps } from './handlers';

const config = goldenConfig('projects/musterstadt-plain.yaml');
const anna: Principal = { kind: 'participant', id: 'anna', projectId: 'p1', roles: ['kontrolle' as never] };
const admin: Principal = { kind: 'admin', id: 'acc', projectId: null, roles: [] };

function api(
  principal: Principal | null,
  deployed = true,
  statuses: Record<number, ConfigVersionStatus> = { 1: 'deployed' },
  extra: Partial<ParticipantApiDeps> = {},
) {
  const deps: ParticipantApiDeps = {
    authenticate: () => principal,
    project: (key) => (key === 'demo' ? { id: 'p1', key } : undefined),
    projectKeyOf: (id) => (id === 'p1' ? 'demo' : undefined),
    projectInfo: (id) => (id === 'p1' ? { displayName: 'Musterstadt', icon: 'ab12' } : undefined),
    participantName: (_key, id) => (id === 'anna' ? 'Anna Beispiel' : null),
    contact: (_key, id) =>
      id === 'anna' ? { email: 'anna@example.org', phone: '0151' } : { email: null, phone: null },
    legalPages: () => [{ slug: 'impressum', title: 'Impressum', body: '<p>x</p>', sortOrder: 1 }],
    sessionExpiresAt: () => '2027-01-01T00:00:00.000Z',
    credential: () => ({ token: 'AAAA-BBBB' }),
    configs: () => ({
      version: (n) => (n === 1 || n === 2 || n === 3 ? config : undefined),
      statusOf: (n) => statuses[n],
      deployed: () => (deployed ? { version: 1, config } : undefined),
    }),
  };
  return createParticipantApi({ ...deps, ...extra });
}
const get = (path = '/x') => new Request(`http://localhost${path}`);

describe('GET bootstrap, device data (WP-660)', () => {
  it('carries e-mail and phone, null for a guest; the info pages in sort order; the legal pages', async () => {
    const body = (await (await api(anna).bootstrap(get())).json()) as Record<string, unknown>;
    expect(body['participant']).toMatchObject({ email: 'anna@example.org', phone: '0151' });
    expect(body['legalPages']).toEqual([{ slug: 'impressum', title: 'Impressum', body: '<p>x</p>' }]);
    const info = body['infoPages'] as { key: string }[];
    expect(info.map((p) => p.key)).toEqual(['willkommen', 'kontakt']); // golden file: sort_order 1, 2
    expect(info[0]).toMatchObject({ title: { de: 'Willkommen', en: 'Welcome' } });
    const guest = await api(anna, true, { 1: 'deployed' }, { contact: () => ({ email: null, phone: null }) });
    expect(
      ((await (await guest.bootstrap(get())).json()) as { participant: object }).participant,
    ).toMatchObject({
      email: null,
      phone: null,
    });
    expect(decodeBootstrap(body).ok).toBe(true);
  });
  it('sorts by sort_order, equal orders keep the authored order', async () => {
    const file = {
      ...config.file,
      info_pages: {
        b: { title: 'b', content: 'b', sort_order: 5 },
        a: { title: 'a', content: 'a' },
        c: { title: 'c', content: 'c', sort_order: 5 },
      },
    };
    const res = await api(
      anna,
      true,
      { 1: 'deployed' },
      {
        configs: () => ({
          version: () => undefined,
          statusOf: () => 'deployed',
          deployed: () => ({ version: 1, config: { ...config, file } }),
        }),
      },
    ).bootstrap(get());
    expect(((await res.json()) as { infoPages: { key: string }[] }).infoPages.map((p) => p.key)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('GET bootstrap', () => {
  it('answers a participant with project key, roles, the deployed version and its compiled form', async () => {
    const res = await api(anna).bootstrap(get());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      project: { key: string };
      participant: { id: string; roles: string[] };
      version: number;
      compiled: CompiledConfigData;
    };
    expect(body).toMatchObject({
      project: { key: 'demo', displayName: 'Musterstadt', icon: 'ab12', preview: false },
      participant: { id: 'anna', name: 'Anna Beispiel', roles: ['kontrolle'] },
      session: { expiresAt: '2027-01-01T00:00:00.000Z' },
      login: { token: 'AAAA-BBBB', link: 'http://localhost/login?token=AAAA-BBBB' },
      version: 1,
    });
    expect(hydrate(body.compiled).hash).toBe(config.hash); // what the device hydrates is the deployed config
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('carries the access value of the actor, the same one the pull header carries (WP-798)', async () => {
    const body = (await (await api(anna).bootstrap(get())).json()) as { access: string };
    expect(body.access).toBe(accessOf({ id: 'anna', kind: 'participant', roles: anna.roles }));
    const other = (await (await api({ ...anna, roles: [] }).bootstrap(get())).json()) as { access: string };
    expect(other.access).not.toBe(body.access);
  });

  it('marks a session of a preview (the key ends in __vorschau) with project.preview, WP-373', async () => {
    const res = await api(anna, true, { 1: 'deployed' }, { projectKeyOf: () => 'demo__vorschau' }).bootstrap(
      get(),
    );
    expect(await res.json()).toMatchObject({ project: { key: 'demo__vorschau', preview: true } });
  });

  it('shows the id when the participant has no name, null for no icon, and no login when no token is active', async () => {
    const res = await api(
      anna,
      true,
      { 1: 'deployed' },
      {
        participantName: () => null,
        projectInfo: () => ({ displayName: 'M', icon: null }),
        credential: () => undefined,
      },
    ).bootstrap(get());
    expect(await res.json()).toMatchObject({
      project: { icon: null },
      participant: { name: 'anna' },
      login: null,
    });
  });

  it('what it sends passes the device decoder, and its size is bounded without the compiled config', async () => {
    const body = (await (await api(anna).bootstrap(get())).json()) as Record<string, unknown>;
    expect(decodeBootstrap(body).ok).toBe(true);
    expect(JSON.stringify({ ...body, compiled: undefined }).length).toBeLessThan(1500);
  });

  it('is 401 without a session, 403 for an admin session and 409 while nothing is deployed', async () => {
    expect((await api(null).bootstrap(get())).status).toBe(401);
    expect((await api(admin).bootstrap(get())).status).toBe(403);
    const res = await api(anna, false).bootstrap(get());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'conflict' } });
  });
});

describe('GET config/<version>', () => {
  it('serves the compiled form of a stored version to a participant of that project', async () => {
    const res = await api(anna).config(get(), { params: { project: 'demo', version: '1' } });
    expect(res.status).toBe(200);
    expect(hydrate((await res.json()) as CompiledConfigData).hash).toBe(config.hash);
  });

  it('is 404 for a version that is gone or not a number, 401 signed out, 403 for another project', async () => {
    const at = (project: string, version: string) => ({ params: { project, version } });
    expect((await api(anna).config(get(), at('demo', '9'))).status).toBe(404);
    expect((await api(anna).config(get(), at('demo', 'abc'))).status).toBe(404);
    expect((await api(null).config(get(), at('demo', '1'))).status).toBe(401);
    expect((await api(anna).config(get(), at('other', '1'))).status).toBe(403);
  });

  it('serves only versions that were deployed (deployed or retired); a draft is 404, like a missing version', async () => {
    const statuses = { 1: 'deployed', 2: 'retired', 3: 'draft' } as const;
    const at = (version: string) => ({ params: { project: 'demo', version } });
    expect((await api(anna, true, statuses).config(get(), at('1'))).status).toBe(200);
    expect((await api(anna, true, statuses).config(get(), at('2'))).status).toBe(200);
    expect((await api(anna, true, statuses).config(get(), at('3'))).status).toBe(404);
  });
});
