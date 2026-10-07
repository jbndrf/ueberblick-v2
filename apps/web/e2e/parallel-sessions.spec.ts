import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { E2E_DATA_DIR } from '../playwright.config';
import { rosterToken } from './seed';

/**
 * WP-705 (owner requirement): an admin session and a participant session work side by side in one browser. One cookie
 * per session kind; signing in as one never replaces the other; signing out of one leaves the other signed in.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PASSWORD = 'correct horse battery';
/** Set per repeat in `beforeAll` (`--repeat-each` reruns it against the same data directory). */
let KEY = 'twinstadt';
let EMAIL = 'twin@example.org';

function admin(args: string[]): number {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return r.status ?? -1;
}

test.beforeAll(({}, info) => {
  KEY = `twinstadt${info.repeatEachIndex}`;
  EMAIL = `twin${info.repeatEachIndex}@example.org`;
  expect(admin(['create-project', KEY, KEY])).toBe(0);
  expect(admin(['create-admin', EMAIL])).toBe(0);
  expect(admin(['add-membership', EMAIL, KEY, 'verwaltung'])).toBe(0);
});

test('a participant and an admin session live side by side in one browser context', async ({ context }) => {
  const names = async () =>
    (await context.cookies())
      .map((c) => c.name)
      .filter((n) => n.startsWith('ub_session'))
      .sort();
  const participantTab = await context.newPage();
  const adminTab = await context.newPage();

  // the admin area is closed to a participant-only browser: the sign-in, never a 403 page
  const token = rosterToken(E2E_DATA_DIR, KEY, 'p-twin', ['kontrolle']);
  const exchange = await context.request.post('/api/auth/exchange', { data: { token } });
  expect(exchange.status()).toBe(200);
  expect(await names()).toEqual(['ub_session_participant']);
  const closed = await context.request.get('/admin/projects', { maxRedirects: 0 });
  expect(closed.status()).toBe(303);
  expect(closed.headers()['location']).toBe('/admin/login?redirectTo=%2Fadmin%2Fprojects');
  await participantTab.goto('/map');
  await expect(participantTab).toHaveURL(/\/map$/);

  // signing in as an admin keeps the participant session
  const login = await context.request.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  expect(login.status()).toBe(200);
  expect(await names()).toEqual(['ub_session_admin', 'ub_session_participant']);
  await adminTab.goto('/admin/projects');
  await expect(adminTab).toHaveURL(/\/admin\/projects$/);

  // both keep working after reloads
  await participantTab.reload();
  await expect(participantTab).toHaveURL(/\/map$/);
  await adminTab.reload();
  await expect(adminTab).toHaveURL(/\/admin\/projects$/);

  // signing out of the admin leaves the participant signed in
  expect((await context.request.post('/admin/logout', { maxRedirects: 0 })).status()).toBe(303);
  expect(await names()).toEqual(['ub_session_participant']);
  expect((await context.request.get('/admin/projects', { maxRedirects: 0 })).status()).toBe(303);
  await participantTab.reload();
  await expect(participantTab).toHaveURL(/\/map$/);

  // and the other way round: sign in as an admin again, sign the participant out, the admin stays
  expect(
    (await context.request.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } })).status(),
  ).toBe(200);
  expect((await context.request.post('/api/auth/logout')).status()).toBe(200);
  expect(await names()).toEqual(['ub_session_admin']);
  await adminTab.reload();
  await expect(adminTab).toHaveURL(/\/admin\/projects$/);
  // an admin session alone does not open the participant map: it goes to the participant sign-in
  await participantTab.goto('/map');
  await expect(participantTab).toHaveURL(/\/login/);
});

test('the old shared cookie is not an admin session any more (no shim)', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  const cookie = (login.headers()['set-cookie'] ?? '').split(';')[0] ?? '';
  const id = cookie.slice(cookie.indexOf('=') + 1);
  const old = await playwright.request.newContext({
    baseURL: baseURL ?? '',
    extraHTTPHeaders: { cookie: `ub_session=${id}` },
  });
  expect((await old.get('/admin/projects', { maxRedirects: 0 })).status()).toBe(303);
  await old.dispose();
  await ctx.dispose();
});
