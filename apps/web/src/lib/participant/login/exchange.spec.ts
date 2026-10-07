import { describe, expect, it } from 'vitest';
import { exchange, type Problem } from './exchange';

const reply =
  (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  () =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status, headers }));

describe('exchange', () => {
  it('posts the token and is ok on 200', async () => {
    let seen: { url: string; body: string } | undefined;
    const r = await exchange((url, init) => {
      seen = { url, body: String(init?.body) };
      return Promise.resolve(new Response('{}', { status: 200 }));
    }, 'tok');
    expect(r).toEqual({ ok: true });
    expect(seen).toEqual({ url: '/api/auth/exchange', body: JSON.stringify({ token: 'tok' }) });
  });

  it('a sign-in tells the other tabs, not its own document, that the session changed; a refusal does not (WP-768)', async () => {
    const posted: unknown[] = [];
    const real = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = class {
      postMessage(m: unknown): void {
        posted.push(m);
      }
      close(): void {}
    } as unknown as typeof BroadcastChannel;
    try {
      await exchange(reply(401, { code: 'credential_unknown' }), 'bad');
      expect(posted).toEqual([]);
      await exchange(reply(200, {}), 'tok');
      expect(posted).toEqual([expect.objectContaining({ type: 'session-changed', toSender: false })]);
    } finally {
      globalThis.BroadcastChannel = real;
    }
  });

  it.each<[string, Problem]>([
    ['credential_unknown', { key: 'login_err_invalid' }],
    ['credential_revoked', { key: 'login_err_invalid' }],
    ['credential_expired', { key: 'login_err_expired' }],
    ['participant_disabled', { key: 'login_err_inactive' }],
    ['token_invalid', { key: 'login_err_generic' }],
    ['something_new', { key: 'login_err_generic' }],
  ])('401 %s shows its text', async (code, problem) => {
    expect(await exchange(reply(401, { code }), 't')).toEqual({ ok: false, problem });
  });

  it('429 shows the rate limit with whole minutes, rounded up', async () => {
    expect(await exchange(reply(429, {}, { 'retry-after': '61' }), 't')).toEqual({
      ok: false,
      problem: { key: 'login_err_rate_limited', values: { minutes: 2 } },
    });
    expect(await exchange(reply(429, {}), 't')).toEqual({
      ok: false,
      problem: { key: 'login_err_rate_limited', values: { minutes: 1 } },
    });
  });

  it('a network failure is offline, a 500 is generic', async () => {
    expect(await exchange(() => Promise.reject(new Error('down')), 't')).toEqual({
      ok: false,
      problem: { key: 'login_err_offline' },
    });
    expect(await exchange(reply(500), 't')).toEqual({ ok: false, problem: { key: 'login_err_generic' } });
  });
});
