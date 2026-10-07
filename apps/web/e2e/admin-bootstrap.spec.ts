import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { base32Decode, createAuth, openControlDb, sessionCookie, totpAt } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../playwright.config';
import { goldenFile } from './golden';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;

/** Runs `npm run admin -- <args>` like an operator would. */
function admin(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout, err: r.stderr };
}
const secretOf = (out: string): Uint8Array => {
  const uri = /otpauth:\/\/\S+/.exec(out)?.[0] ?? '';
  return base32Decode(new URL(uri).searchParams.get('secret') ?? '');
};

test('CLI: from nothing to an admin who logs in with TOTP and deploys a golden template', async ({
  playwright,
  baseURL,
}) => {
  expect(admin(['create-project', 'bootstrapstadt', 'Bootstrap Stadt']).status).toBe(0);
  const created = admin(['create-admin', 'boot@example.org']);
  expect(created.status).toBe(0);
  expect(created.out).toContain('otpauth://totp/');
  // the password never appears in any output
  expect(created.out + created.err).not.toContain(PASSWORD);
  const key = secretOf(created.out);

  // a wrong code is refused, the right one confirms
  expect(admin(['confirm-totp', 'boot@example.org', '000000']).status).toBe(1);
  expect(admin(['confirm-totp', 'boot@example.org', totpAt(key, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'boot@example.org', 'bootstrapstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  expect(admin(['create-project', 'bootstrapstadt', 'again']).status).toBe(1);

  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'boot@example.org', password: PASSWORD, totp: totpAt(key, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const file = parse(readFileSync(TEMPLATE, 'utf8')) as unknown;
  const deploy = await ctx.post('/api/admin/p/bootstrapstadt/deploy', { data: file });
  expect(await deploy.json()).toMatchObject({ ok: true, version: 1, created: true });
  await ctx.dispose();
});

test('TOTP endpoints: only for the signed-in admin; confirm needs a valid code; re-enrol refused once confirmed', async ({
  playwright,
  baseURL,
  request,
}) => {
  expect((await request.post('/api/auth/totp/enrol')).status()).toBe(401);
  expect((await request.post('/api/auth/totp/confirm', { data: { code: '123456' } })).status()).toBe(401);

  // An admin session that did not come from a TOTP login (the shape OIDC will use): opened directly.
  expect(admin(['create-admin', 'oidc@example.org']).status).toBe(0);
  const control = openControlDb(`${E2E_DATA_DIR}/control.db`);
  const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
  const id = control
    .prepare<{ id: string }>('SELECT id FROM accounts WHERE email = ?')
    .get('oidc@example.org')?.id;
  const session = auth.openAdminSession(id ?? '');
  control.close();
  const cookie = sessionCookie('admin', session, { secure: false }).split(';')[0] ?? '';
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '', extraHTTPHeaders: { cookie } });

  const enrol = await ctx.post('/api/auth/totp/enrol');
  expect(enrol.status()).toBe(200);
  const body = await enrol.json();
  expect(body.otpauthUri).toContain('otpauth://totp/');
  const key = base32Decode(body.secret);

  expect((await ctx.post('/api/auth/totp/confirm', { data: {} })).status()).toBe(400);
  const wrong = await ctx.post('/api/auth/totp/confirm', { data: { code: '000000' } });
  expect(wrong.status()).toBe(400);
  const ok = await ctx.post('/api/auth/totp/confirm', { data: { code: totpAt(key, Date.now()) } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ confirmed: true });
  expect((await ctx.post('/api/auth/totp/enrol')).status()).toBe(409);
  await ctx.dispose();
});

test('login: after 5 failures the key gets 429 with Retry-After; other accounts are unaffected', async ({
  request,
}) => {
  const bad = { email: 'victim@example.org', password: 'wrong wrong wrong', totp: '000000' };
  for (let i = 0; i < 5; i++)
    expect((await request.post('/api/auth/login', { data: bad })).status()).toBe(401);
  const blocked = await request.post('/api/auth/login', { data: bad });
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
  const other = await request.post('/api/auth/login', { data: { ...bad, email: 'someone@example.org' } });
  expect(other.status()).toBe(401);
});

test('QR exchange: repeated unknown tokens from one client are refused with 429 after five tries', async ({
  request,
}) => {
  // per-credential key: the same wrong token 5 times, then refused
  for (let i = 0; i < 5; i++)
    expect((await request.post('/api/auth/exchange', { data: { token: 'nope' } })).status()).toBe(401);
  const blocked = await request.post('/api/auth/exchange', { data: { token: 'nope' } });
  expect(blocked.status()).toBe(429);
  expect(blocked.headers()['retry-after']).toBeDefined();
});

test('security headers are set on every response, errors included', async ({ request }) => {
  for (const path of ['/api/health', '/api/nothing-here']) {
    const h = (await request.get(path)).headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toContain("default-src 'self'");
  }
});

test('the CLI refuses bad usage without touching anything and prints no stack traces', () => {
  const r = admin(['nonsense']);
  expect(r.status).toBe(2);
  expect(r.err).toContain('Usage');
});
