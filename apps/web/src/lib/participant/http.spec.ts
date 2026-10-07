import { BOOTSTRAP_CACHE_FORMAT } from './decode';
import { describe, expect, it } from 'vitest';
import { loadBootstrap, type BootstrapCache, type FetchLike } from './http';

const reply = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function recorder(answer: (url: string, init?: RequestInit) => Response | Error) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const r = answer(url, init);
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, fetch };
}

const compiled = { format: 1, file: {}, hash: 'h', expressions: [] };
const identity = {
  project: { key: 'demo', displayName: 'Musterstadt', icon: 'ab12', preview: true },
  participant: { id: 'a', name: 'Anna', roles: [], email: 'anna@example.org', phone: null },
  infoPages: [{ key: 'hilfe', title: { de: 'Hilfe' }, content: { de: '<p>x</p>' } }],
  legalPages: [{ slug: 'impressum', title: 'Impressum', body: '<p>Anschrift</p>' }],
  version: 1,
  session: { expiresAt: '2027-01-01T00:00:00.000Z' },
  login: { token: 'AAAA', link: 'http://x/login?token=AAAA' },
};

function memory(initial: string | null = null) {
  let value = initial;
  const cache: BootstrapCache = {
    read: () => value,
    write: (t) => void (value = t),
    clear: () => void (value = null),
  };
  return { cache, text: () => value };
}

describe('loadBootstrap', () => {
  it('reads the bootstrap; 401 is signed_out; anything else is failed with its status', async () => {
    const ok = { ...identity, compiled };
    const none = memory();
    expect(await loadBootstrap(recorder(() => reply(200, ok)).fetch, none.cache)).toEqual({
      kind: 'ok',
      bootstrap: ok,
      offline: false,
    });
    const bad = await loadBootstrap(recorder(() => reply(200, { ...ok, compiled: {} })).fetch, none.cache);
    expect(bad.kind).toBe('invalid');
    expect((await loadBootstrap(recorder(() => reply(200, 'not json')).fetch, none.cache)).kind).toBe(
      'invalid',
    );
    expect(await loadBootstrap(recorder(() => reply(401, {})).fetch, none.cache)).toEqual({
      kind: 'signed_out',
    });
    expect(await loadBootstrap(recorder(() => reply(409, {})).fetch, none.cache)).toEqual({
      kind: 'failed',
      status: 409,
    });
    expect(await loadBootstrap(recorder(() => new Error('offline')).fetch, memory().cache)).toEqual({
      kind: 'failed',
      status: undefined,
    });
  });

  it('caches the identity (not the compiled config); offline start shows name, project, icon and expiry from it', async () => {
    const m = memory();
    const online = await loadBootstrap(recorder(() => reply(200, { ...identity, compiled })).fetch, m.cache);
    expect(online).toMatchObject({ kind: 'ok', offline: false });
    expect(m.text()).not.toContain('expressions');
    const off = await loadBootstrap(recorder(() => new Error('offline')).fetch, m.cache);
    expect(off).toEqual({ kind: 'ok', bootstrap: { ...identity, login: null }, offline: true });
    if (off.kind === 'ok') {
      expect(off.bootstrap.participant.name).toBe('Anna');
      expect(off.bootstrap.project).toEqual({
        key: 'demo',
        displayName: 'Musterstadt',
        icon: 'ab12',
        preview: true,
      });
      expect(off.bootstrap.session.expiresAt).toBe('2027-01-01T00:00:00.000Z');
      // offline cold start (fixes v3 B8): e-mail, info pages and legal pages come from the device
      expect(off.bootstrap.participant.email).toBe('anna@example.org');
      expect(off.bootstrap.infoPages.map((p) => p.key)).toEqual(['hilfe']);
      expect(off.bootstrap.legalPages.map((p) => p.slug)).toEqual(['impressum']);
    }
  });

  it('the cache holds no login token or link; the online bootstrap still carries them (WP-772)', async () => {
    const m = memory();
    const online = await loadBootstrap(recorder(() => reply(200, { ...identity, compiled })).fetch, m.cache);
    expect(online).toMatchObject({ kind: 'ok', bootstrap: { login: identity.login } });
    expect(m.text()).not.toContain('AAAA');
    expect(m.text()).not.toContain('token=');
    const off = await loadBootstrap(recorder(() => new Error('offline')).fetch, m.cache);
    expect(off).toMatchObject({ kind: 'ok', offline: true, bootstrap: { login: null } });
  });

  it('a cache of the earlier format, which held the token, is refused', async () => {
    const old = memory(JSON.stringify({ format: BOOTSTRAP_CACHE_FORMAT - 1, identity }));
    expect((await loadBootstrap(recorder(() => new Error('offline')).fetch, old.cache)).kind).toBe('failed');
  });

  it('an unknown cached shape is not used offline; a server refusal is never answered from the cache', async () => {
    const stale = memory(JSON.stringify({ format: 99, identity }));
    expect((await loadBootstrap(recorder(() => new Error('offline')).fetch, stale.cache)).kind).toBe(
      'failed',
    );
    const m = memory();
    await loadBootstrap(recorder(() => reply(200, { ...identity, compiled })).fetch, m.cache);
    expect((await loadBootstrap(recorder(() => reply(500, {})).fetch, m.cache)).kind).toBe('failed');
  });

  it('a 401 clears the cache, so the next person on the phone sees nothing of the last', async () => {
    const m = memory();
    await loadBootstrap(recorder(() => reply(200, { ...identity, compiled })).fetch, m.cache);
    await loadBootstrap(recorder(() => reply(401, {})).fetch, m.cache);
    expect(m.text()).toBeNull();
  });

  it('an expired cached identity never opens the app offline (WP-769; v3 checked the token exp on a cold start)', async () => {
    const m = memory();
    await loadBootstrap(recorder(() => reply(200, { ...identity, compiled })).fetch, m.cache);
    const off = recorder(() => new Error('offline')).fetch;
    const before = Date.parse('2027-01-01T00:00:00.000Z') - 1;
    const after = Date.parse('2027-01-01T00:00:00.000Z');
    expect((await loadBootstrap(off, m.cache, () => before)).kind).toBe('ok');
    expect((await loadBootstrap(off, m.cache, () => after)).kind).toBe('signed_out');
    expect(m.text()).toBeNull();
  });

  it('a cache that cannot write does not stop the start', async () => {
    const broken: BootstrapCache = {
      read: () => null,
      write: () => {
        throw new Error('quota');
      },
      clear: () => undefined,
    };
    const r = await loadBootstrap(recorder(() => reply(200, { ...identity, compiled })).fetch, broken);
    expect(r.kind).toBe('ok');
  });
});
