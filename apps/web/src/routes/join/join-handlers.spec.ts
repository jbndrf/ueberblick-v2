import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instanceStoreFor, readSessionCookie, setSelfJoin, type Principal } from '@ueberblick/server';
import type * as Handlers from './join-handlers';
import type * as RuntimeModule from '../../lib/server/runtime';

// WP-639: the REAL join handlers over the real runtime (a data dir in /tmp, no timers loop).
const dir = mkdtempSync(join(tmpdir(), 'ub-join-'));
let h: typeof Handlers;
let rt: ReturnType<(typeof RuntimeModule)['runtime']>;
// A failed or timed-out beforeAll leaves these unset: the teardown must not throw on top (WP-1021).
let stop: () => void = () => undefined;

beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  h = await import('./join-handlers');
  rt = (await import('../../lib/server/runtime')).runtime();
  stop = () => rt.stop();
  rt.control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run('id-alpha', 'alpha', 'Alpha', 'x');
  const deps = { control: rt.control, now: () => new Date() };
  setSelfJoin(deps, 'id-alpha', 'melder', { enabled: true, slug: 'maengel' });
  setSelfJoin(deps, 'id-alpha', 'zu', { enabled: false, slug: 'zu-link' });
}, 30_000); // WP-1021: ~0.1 s now that join renders through server-messages (was 5.6 s: the Paraglide barrel)

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

let ip = 0;
const call = (slug: string, opts: { next?: string; principal?: Principal | null; address?: string } = {}) => {
  const address = opts.address ?? `10.0.0.${++ip}`;
  const url = new URL(
    `http://localhost:3000/join/${slug}${opts.next === undefined ? '' : `?next=${encodeURIComponent(opts.next)}`}`,
  );
  return {
    request: new Request(url, { method: 'POST' }),
    params: { slug },
    url,
    locals: { participant: opts.principal ?? null },
    getClientAddress: () => address,
  };
};
const guests = () =>
  rt.projectDb('alpha').prepare<{ n: number }>('SELECT count(*) AS n FROM participants').get()?.n ?? 0;

describe('GET /join/<slug> (view)', () => {
  it('creates nothing, however often it is opened (link previews)', () => {
    for (let i = 0; i < 3; i++)
      expect(h.view(call('maengel'))).toEqual({ kind: 'form', slug: 'maengel', next: '/map' });
    expect(guests()).toBe(0);
  });

  it('an unknown or switched-off slug is "Not found" (404), in the visitor\'s language', () => {
    expect(h.view(call('gibt-es-nicht'))).toMatchObject({
      kind: 'refused',
      status: 404,
      text: 'Nicht gefunden.',
    });
    expect(h.view(call('zu-link'))).toMatchObject({ kind: 'refused', status: 404 });
    const en = call('zu-link');
    expect(
      h.view({ ...en, request: new Request(en.url, { headers: { 'accept-language': 'en' } }) }),
    ).toMatchObject({
      text: 'Not found.',
    });
  });

  it('throttles repeated wrong slugs from one address (429)', () => {
    const address = `10.9.9.${++ip}`;
    for (let i = 0; i < 5; i++) expect(h.view(call('raten', { address }))).toMatchObject({ status: 404 });
    expect(h.view(call('raten', { address }))).toMatchObject({ kind: 'refused', status: 429 });
  });
});

describe('POST /join/<slug>/start', () => {
  it('creates a guest, signs them in with the session cookie and goes to the map', () => {
    const before = guests();
    const r = h.start(call('maengel'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/map');
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(guests()).toBe(before + 1);
    const session = readSessionCookie(
      new Request('http://x/', { headers: { cookie: cookie.split(';')[0] ?? '' } }),
      'participant',
    );
    expect(rt.auth.authenticate(session)).toMatchObject({
      kind: 'participant',
      projectId: 'id-alpha',
      roles: ['melder'],
    });
  });

  it('follows ?next= only for a path of this app', () => {
    expect(h.start(call('maengel', { next: '/app?x=1' })).headers.get('location')).toBe('/app?x=1');
    expect(h.start(call('maengel', { next: '//evil.example' })).headers.get('location')).toBe('/map');
    expect(h.start(call('maengel', { next: 'https://evil.example' })).headers.get('location')).toBe('/map');
  });

  it('rescanning on a device that holds a guest session signs that guest in again: no second guest, no new cookie', () => {
    const first = h.start(call('maengel'));
    const id = (first.headers.get('set-cookie') ?? '').split(';')[0]?.split('=')[1];
    const principal = rt.auth.authenticate(id);
    const before = guests();
    const again = h.start(call('maengel', { principal }));
    expect(again.status).toBe(303);
    expect(again.headers.get('set-cookie')).toBeNull();
    expect(guests()).toBe(before);
    expect(h.view(call('maengel', { principal }))).toEqual({ kind: 'go', to: '/map' });
  });

  it('an unknown or switched-off slug creates nothing (404)', () => {
    const before = guests();
    expect(h.start(call('zu-link')).status).toBe(404);
    expect(h.start(call('nope')).status).toBe(404);
    expect(guests()).toBe(before);
  });
});

describe('consent gate (WP-638 gate, as v3: before any guest is created)', () => {
  const withCookie = (c: ReturnType<typeof call>, cookie: string) => ({
    ...c,
    request: new Request(c.url, { method: 'POST', headers: { cookie } }),
  });
  const set = (requireConsent: boolean) => {
    const store = instanceStoreFor(rt);
    store.saveSettings({ ...store.settings(), requireConsent });
  };
  afterAll(() => set(false));

  it('GET bounces to /login?returnTo=<link> without consent, and creates nothing', () => {
    set(true);
    const before = guests();
    expect(h.view(call('maengel', { next: '/app' }))).toEqual({
      kind: 'consent',
      to: `/login?returnTo=${encodeURIComponent('/join/maengel?next=%2Fapp')}`,
    });
    expect(guests()).toBe(before);
  });

  it('POST is refused (403 consent_required) without consent: no guest', async () => {
    set(true);
    const before = guests();
    const r = h.start(call('maengel'));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ code: 'consent_required' });
    expect(guests()).toBe(before);
  });

  it('with the accepted cookie the join works as before', () => {
    set(true);
    expect(h.view(withCookie(call('maengel'), 'consent=accepted'))).toMatchObject({ kind: 'form' });
    expect(h.start(withCookie(call('maengel'), 'consent=accepted')).status).toBe(303);
  });
});
