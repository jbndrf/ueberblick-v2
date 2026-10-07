import { describe, expect, it } from 'vitest';
import { loginProblem, safeNext, signIn } from './admin-login';

describe('safeNext: only same-origin paths', () => {
  it.each([
    ['/builder/musterstadt', '/builder/musterstadt'],
    ['/builder/musterstadt?lens=yaml', '/builder/musterstadt?lens=yaml'],
    ['/builder', '/builder'],
  ])('accepts %s', (raw, out) => expect(safeNext(raw)).toBe(out));

  it.each([
    'https://evil',
    'https://evil/builder',
    '//evil',
    '//evil/builder',
    '/\\evil',
    '\\\\evil',
    'javascript:alert(1)',
    'JaVaScript:alert(1)',
    'builder/x',
    '',
    '/\tbuilder',
    '/builder\n',
  ])('rejects %j and falls back to /builder', (raw) => expect(safeNext(raw)).toBe('/builder'));

  it('falls back for null and undefined', () => {
    expect(safeNext(null)).toBe('/builder');
    expect(safeNext(undefined)).toBe('/builder');
  });
});

describe('loginProblem: one message per cause, none names the wrong field', () => {
  it('maps the statuses and codes', () => {
    expect(loginProblem(401, 'invalid_login')).toBe('login_invalid');
    expect(loginProblem(401, 'mfa_not_enrolled')).toBe('login_not_enrolled');
    expect(loginProblem(429, undefined)).toBe('login_throttled');
    expect(loginProblem(400, undefined)).toBe('login_failed');
    expect(loginProblem(500, undefined)).toBe('login_failed');
  });
});

const creds = { email: 'a@b.c', password: 'pw', totp: '123456', remember: false };
const reply = (status: number, body: unknown): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;

describe('signIn', () => {
  it('posts the credentials and reports success', async () => {
    let seen: { url: string; body: unknown } | undefined;
    const f = ((url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
    expect(await signIn(f, creds)).toEqual({ ok: true });
    expect(seen).toEqual({ url: '/api/auth/login', body: creds });
  });

  it('gives the same message for a wrong password and a wrong code', async () => {
    const r = await signIn(reply(401, { code: 'invalid_login' }), creds);
    expect(r).toEqual({ ok: false, problem: 'login_invalid' });
  });

  it('maps 429 and a network failure', async () => {
    expect(await signIn(reply(429, { error: 'x' }), creds)).toEqual({
      ok: false,
      problem: 'login_throttled',
    });
    const down = (() => Promise.reject(new Error('net'))) as typeof fetch;
    expect(await signIn(down, creds)).toEqual({ ok: false, problem: 'login_offline' });
  });
});

describe('signIn: remember and enrolment (WP-942)', () => {
  it('sends the "angemeldet bleiben" choice', async () => {
    let body: unknown;
    const f = ((_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
    await signIn(f, { ...creds, remember: true });
    expect(body).toMatchObject({ remember: true });
  });

  it('hands the otpauth URI of an account without a confirmed code to the page', async () => {
    const r = await signIn(
      reply(401, { code: 'mfa_not_enrolled', otpauthUri: 'otpauth://totp/x?secret=AAAA' }),
      { ...creds, totp: '' },
    );
    expect(r).toEqual({
      ok: false,
      problem: 'login_not_enrolled',
      otpauthUri: 'otpauth://totp/x?secret=AAAA',
    });
  });

  it('shows no URI for an ordinary refusal', async () => {
    expect(await signIn(reply(401, { code: 'invalid_login' }), creds)).toEqual({
      ok: false,
      problem: 'login_invalid',
    });
  });
});
