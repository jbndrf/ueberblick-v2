import { describe, expect, it } from 'vitest';
import { respond, storableShell, type HandlerDeps } from './handler';

const ORIGIN = 'https://app.test';
const assets = new Set(['/a.js']);

function deps(
  over: Partial<HandlerDeps> = {},
): HandlerDeps & { matched: string[]; fetched: string[]; revalidated: string[] } {
  const matched: string[] = [];
  const fetched: string[] = [];
  const revalidated: string[] = [];
  return {
    origin: ORIGIN,
    assets,
    match: (key) => {
      matched.push(key);
      return Promise.resolve(new Response(`cache:${key}`));
    },
    fetch: (r) => {
      fetched.push(new URL(r.url).pathname);
      return Promise.resolve(new Response('network'));
    },
    revalidate: (path) => revalidated.push(path),
    matched,
    fetched,
    revalidated,
    ...over,
  };
}
const get = (path: string) => new Request(`${ORIGIN}${path}`);

describe('respond', () => {
  it('never serves /api/** or the bootstrap from the cache: it does not answer, the browser asks the server', async () => {
    const d = deps();
    for (const p of ['/api/p/k/sync', '/api/auth/exchange', '/participant-api/bootstrap']) {
      expect(await respond(get(p), false, d)).toBeUndefined();
      expect(await respond(get(p), true, d)).toBeUndefined();
    }
    expect(d.matched).toEqual([]);
    expect(d.fetched).toEqual([]);
  });

  it('answers the shell from the cache without asking the network', async () => {
    const d = deps();
    const r = await respond(get('/login?token=x'), true, d);
    expect(await r?.text()).toBe('cache:/login');
    expect(d.fetched).toEqual([]);
  });

  it('refreshes a served shell in the background, so the next start has the current CSP (WP-957)', async () => {
    const d = deps();
    await respond(get('/map'), true, d);
    await respond(get('/a.js'), false, d);
    expect(d.revalidated).toEqual(['/map']);
    const none = deps({ match: () => Promise.resolve(undefined) });
    await respond(get('/login'), true, none);
    expect(none.revalidated).toEqual([]);
  });

  it('falls back to the network when the shell is not cached yet', async () => {
    const d = deps({ match: () => Promise.resolve(undefined) });
    expect(await (await respond(get('/map'), true, d))?.text()).toBe('network');
  });

  it('redirects the start page to the map when offline', async () => {
    const d = deps({ fetch: () => Promise.reject(new Error('offline')) });
    const r = await respond(get('/'), true, d);
    expect(r?.status).toBe(302);
    expect(new URL(r?.headers.get('location') ?? '').pathname).toBe('/map');
  });

  it('serves a precached asset from the cache and returns undefined for what it does not handle', async () => {
    const d = deps();
    expect(await (await respond(get('/a.js'), false, d))?.text()).toBe('cache:/a.js');
    expect(await respond(get('/admin/login'), true, d)).toBeUndefined();
  });
});

describe('redirected shells (WP-853)', () => {
  const redirected = (): Response => {
    const r = new Response('login page');
    Object.defineProperty(r, 'redirected', { value: true });
    return r;
  };

  it('never stores a redirected or failed answer as a shell', () => {
    expect(storableShell(new Response('ok'))).toBe(true);
    expect(storableShell(redirected())).toBe(false);
    expect(storableShell(new Response('no', { status: 500 }))).toBe(false);
  });

  it('ignores a poisoned (redirected) cached shell, asks the network and refreshes the entry', async () => {
    const d = deps({ match: () => Promise.resolve(redirected()) });
    const r = await respond(get('/map'), true, d);
    expect(await r?.text()).toBe('network');
    expect(d.fetched).toEqual(['/map']);
    expect(d.revalidated).toEqual(['/map']);
  });
});
