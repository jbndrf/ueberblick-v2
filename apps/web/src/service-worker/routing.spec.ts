import { describe, expect, it } from 'vitest';
import { cacheNameFor, routeFor, staleCaches } from './routing';

const ORIGIN = 'https://app.test';
const assets = new Set([
  '/_app/immutable/entry/start.abc.js',
  '/icons/icon-192.png',
  '/manifest.webmanifest',
]);
const req = (path: string, init: { method?: string; navigate?: boolean; origin?: string } = {}) => ({
  url: new URL(path, init.origin ?? ORIGIN),
  method: init.method ?? 'GET',
  navigate: init.navigate ?? false,
});
const route = (path: string, init?: Parameters<typeof req>[1]) => routeFor(req(path, init), ORIGIN, assets);

describe('routeFor', () => {
  it('never lets the cache answer the data endpoints', () => {
    for (const p of [
      '/api/p/karte/sync',
      '/api/auth/exchange',
      '/api/health',
      '/participant-api/bootstrap',
      '/api/p/k/blobs/abc',
    ])
      expect(route(p)).toEqual({ kind: 'network' });
    expect(route('/api/p/karte/sync', { navigate: true })).toEqual({ kind: 'network' });
  });

  it('serves the participant shells cache-first, whatever the query', () => {
    expect(route('/map', { navigate: true })).toEqual({ kind: 'shell', shell: '/map' });
    expect(route('/login?token=abc', { navigate: true })).toEqual({ kind: 'shell', shell: '/login' });
  });

  it('serves precached build files and static files cache-first', () => {
    expect(route('/_app/immutable/entry/start.abc.js')).toEqual({ kind: 'asset' });
    expect(route('/icons/icon-192.png')).toEqual({ kind: 'asset' });
  });

  it('sends a navigation to the start page to the map when the network fails', () => {
    expect(route('/', { navigate: true })).toEqual({ kind: 'network-or-map' });
  });

  it('leaves everything else to the network', () => {
    expect(route('/admin/login', { navigate: true })).toEqual({ kind: 'network' });
    expect(route('/legal', { navigate: true })).toEqual({ kind: 'network' });
    expect(route('/tiles/0/0/0.pbf')).toEqual({ kind: 'network' });
    expect(route('/map', { method: 'POST' })).toEqual({ kind: 'network' });
    expect(route('/_app/immutable/entry/start.abc.js', { origin: 'https://other.test' })).toEqual({
      kind: 'network',
    });
  });
});

describe('cache names', () => {
  it('are versioned by the build and old ones are deleted', () => {
    const now = cacheNameFor('v2');
    expect(now).not.toBe(cacheNameFor('v1'));
    expect(staleCaches([cacheNameFor('v1'), now, 'ub-shell-v0', 'other-app'], now).sort()).toEqual(
      [cacheNameFor('v1'), 'ub-shell-v0'].sort(),
    );
  });
});
