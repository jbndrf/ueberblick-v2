// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device, DevicePorts } from './device';
import type { BootstrapCache, BootstrapResult, DeviceStart } from './http';
import { signOutSession, startSession, type SessionLoad } from './session';
import { InsecureContextError } from '@ueberblick/client';

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const identity = {
  project: { key: 'demo', displayName: 'Demo', icon: null, preview: false },
  participant: { id: 'vera', name: 'Vera', roles: ['r'], email: null, phone: null },
  version: 1,
  session: { expiresAt: '2027-01-01T00:00:00.000Z' },
  login: null,
  infoPages: [],
  legalPages: [],
};
const cache = (): BootstrapCache & { cleared: number } => {
  const c = { cleared: 0, read: () => null, write: () => undefined, clear: () => void c.cleared++ };
  return c;
};
const device = (id: string) => ({ participant: { id }, close: vi.fn() }) as unknown as Device;
const ports = {} as DevicePorts;

function load(over: Partial<SessionLoad> = {}) {
  const calls: { current: Device | undefined; boot: DeviceStart; locale: string }[] = [];
  const l: SessionLoad = {
    ports: () => ports,
    switchDevice: async (current, boot, _p, locale) => {
      calls.push({ current, boot, locale });
      return device(boot.participant.id);
    },
    ...over,
  };
  return { l, calls };
}

afterEach(() => localStorage.clear());

const ok = (): BootstrapResult => ({ kind: 'ok', bootstrap: identity as DeviceStart, offline: false });

describe('startSession', () => {
  it('opens the device through switchDevice, with the open device and the person language', async () => {
    const current = device('vera');
    const { l, calls } = load();
    const r = await startSession({ bootstrap: async () => ok(), load: async () => l, current, locale: 'en' });
    expect(r.kind).toBe('ready');
    expect(calls[0]?.current).toBe(current);
    expect(calls[0]?.locale).toBe('en');
  });

  it('a signed-out answer sends the person to the sign-in page; a refusal and a failure are told apart', async () => {
    const run = (b: BootstrapResult) =>
      startSession({ bootstrap: async () => b, load: async () => load().l, locale: 'de' });
    expect(await run({ kind: 'signed_out' })).toEqual({ kind: 'signed_out' });
    expect(await run({ kind: 'invalid', reason: 'x' })).toEqual({ kind: 'failed', invalid: 'x' });
    expect(await run({ kind: 'failed', status: 500 })).toEqual({ kind: 'failed' });
  });

  it('offline with no cached identity (signed out here) goes to the sign-in page, which says it needs the network (WP-866; v3 layout onMount goto /login)', async () => {
    const r = await startSession({
      bootstrap: async () => ({ kind: 'failed', status: undefined }),
      load: async () => load().l,
      locale: 'de',
    });
    expect(r).toEqual({ kind: 'signed_out' });
  });

  it('plain http is the https notice, anything else "could not be loaded"', async () => {
    const run = (e: unknown) =>
      startSession({
        bootstrap: async () => ok(),
        locale: 'de',
        load: async () => load({ switchDevice: async () => Promise.reject(e) }).l,
      });
    expect(await run(new InsecureContextError())).toEqual({ kind: 'notice', notice: 'insecure_context' });
    expect(await run(new Error('x'))).toEqual({ kind: 'notice', notice: 'load_failed' });
  });
});

describe('signOutSession', () => {
  it('ends the session on the server and forgets the cached identity of the person', async () => {
    const c = cache();
    const seen: string[] = [];
    await signOutSession(async (url, init) => (seen.push(`${init?.method} ${url}`), reply(200)), c);
    expect(seen).toEqual(['POST /api/auth/logout']);
    expect(c.cleared).toBe(1);
  });

  it('with no network the session stands: it rejects and the cached identity stays for the offline start', async () => {
    const c = cache();
    await expect(signOutSession(async () => Promise.reject(new Error('offline')), c)).rejects.toThrow(
      'offline',
    );
    expect(c.cleared).toBe(0);
  });
});

describe('signOutSession wipes the device (WP-769)', () => {
  it('after the server ended the session, the wipe runs and then the cached identity goes', async () => {
    const c = cache();
    const order: string[] = [];
    await signOutSession(
      async () => reply(200),
      c,
      async () => void order.push(`wipe cleared=${c.cleared}`),
    );
    expect(order).toEqual(['wipe cleared=0']);
    expect(c.cleared).toBe(1);
  });

  it('offline nothing is wiped: the session and the local copy stand', async () => {
    const c = cache();
    const wipe = vi.fn(async () => undefined);
    await expect(signOutSession(async () => Promise.reject(new Error('offline')), c, wipe)).rejects.toThrow();
    expect(wipe).not.toHaveBeenCalled();
  });

  it('a wipe that fails does not keep the person signed in on the screen', async () => {
    const c = cache();
    await signOutSession(
      async () => reply(200),
      c,
      async () => Promise.reject(new Error('blocked')),
    );
    expect(c.cleared).toBe(1);
  });
});
