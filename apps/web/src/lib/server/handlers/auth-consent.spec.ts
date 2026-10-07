import { describe, expect, it, vi } from 'vitest';
import { createAuth, instanceStoreFor, openControlDb } from '@ueberblick/server';
import type { Key } from '@ueberblick/core';

const control = openControlDb(':memory:');
control.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run('p1', 't', 't', 'x');
const now = () => new Date('2026-10-01T08:00:00.000Z');
const auth = createAuth({ control, now, participantRoles: () => ['melder' as Key] });
const rt = {
  control,
  auth,
  clock: { now: () => now().toISOString() },
  secureCookies: false,
  log: { log: () => {} },
};
vi.mock('../runtime', () => ({ runtime: () => rt }));
const { exchange } = await import('./auth');

const post = (token: string, cookie?: string) =>
  ({
    locals: { admin: null, participant: null },
    params: {},
    request: new Request('http://x/api/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ token }),
    }),
    getClientAddress: () => '127.0.0.1',
  }) as unknown as Parameters<typeof exchange>[0];

const store = instanceStoreFor(rt);
const requireConsent = (on: boolean) => store.saveSettings({ ...store.settings(), requireConsent: on });

describe('exchange and the consent gate (WP-638)', () => {
  it('without the gate a valid token signs in with no cookie at all', async () => {
    const issued = auth.issueCredential('p1', 'mia');
    expect((await exchange(post(issued.token))).status).toBe(200);
  });

  it('with consent on, an exchange without the cookie is refused with the registry code and uses no credential', async () => {
    requireConsent(true);
    const issued = auth.issueCredential('p1', 'bernd');
    const refused = await exchange(post(issued.token));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: 'consent_required' });
    expect((await exchange(post(issued.token, 'consent=rejected'))).status).toBe(403);
    expect((await exchange(post(issued.token, 'consent=accepted'))).status).toBe(200);
  });
});
