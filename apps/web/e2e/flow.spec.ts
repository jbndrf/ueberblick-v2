import { expect, test } from '@playwright/test';
import { E2E_DATA_DIR } from '../playwright.config';
import { revokeTokens, rosterToken, seedControl, type Seeded } from './seed';
import { goldenData } from './golden';

const golden = goldenData;

let seeded: Seeded;
test.beforeAll(async () => {
  seeded = await seedControl(E2E_DATA_DIR, ['musterstadt', 'overlay']);
});

test('health is public and shows no session', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ ok: true, admin: null, participant: null });
});

test('QR exchange sets a session cookie and health shows the participant; the token is reusable', async ({
  playwright,
  baseURL,
}) => {
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const r = await ctx.post('/api/auth/exchange', { data: { token: seeded.participantToken } });
  expect(r.status()).toBe(200);
  expect(r.headers()['set-cookie']).toContain('HttpOnly');
  const health = await (await ctx.get('/api/health')).json();
  expect(health.participant).toMatchObject({
    kind: 'participant',
    id: 'participant-1',
    projectId: 'id-musterstadt',
  });
  const again = await ctx.post('/api/auth/exchange', { data: { token: seeded.participantToken } });
  expect(again.status()).toBe(200); // a token is reusable (WP-606)
  await ctx.dispose();
});

test('a revoked token is refused, a reusable one is not', async ({ playwright, baseURL }) => {
  const token = rosterToken(E2E_DATA_DIR, 'musterstadt', 'participant-revoked', ['kontrolle']);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect((await ctx.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  revokeTokens(E2E_DATA_DIR, 'musterstadt', 'participant-revoked');
  expect((await ctx.post('/api/auth/exchange', { data: { token } })).status()).toBe(401);
  await ctx.dispose();
});

test('a participant and an anonymous caller cannot use the admin API', async ({
  request,
  playwright,
  baseURL,
}) => {
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await ctx.post('/api/auth/exchange', { data: { token: seeded.spareToken } });
  // the admin API reads the admin cookie only: a participant-only browser is not signed in there (WP-705)
  expect((await ctx.get('/api/admin/p/musterstadt/versions')).status()).toBe(401);
  await ctx.dispose();
  const anon = await request.get('/api/admin/p/musterstadt/versions');
  expect(anon.status()).toBe(401);
});

test('admin login with TOTP, deploy a golden template, list versions, dry-run plan, logout', async ({
  playwright,
  baseURL,
}) => {
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const bad = await ctx.post('/api/auth/login', {
    data: { email: seeded.email, password: 'wrong wrong wrong', totp: '000000' },
  });
  expect(bad.status()).toBe(401);
  expect(await bad.json()).toEqual({ code: 'invalid_login' });

  const login = await ctx.post('/api/auth/login', {
    data: { email: seeded.email, password: seeded.password, totp: seeded.totp() },
  });
  expect(login.status()).toBe(200);
  expect((await (await ctx.get('/api/health')).json()).admin.kind).toBe('admin');

  const file = golden('templates/baumkataster/1.0.0.yaml');
  const plan = await ctx.post('/api/admin/p/musterstadt/plan', { data: file });
  expect(plan.status()).toBe(200);
  expect((await plan.json()).ok).toBe(true);
  expect(await (await ctx.get('/api/admin/p/musterstadt/versions')).json()).toEqual([]);

  const deploy = await ctx.post('/api/admin/p/musterstadt/deploy', { data: file });
  expect(deploy.status()).toBe(200);
  const result = await deploy.json();
  expect(result).toMatchObject({ ok: true, version: 1, created: true });

  const versions = await (await ctx.get('/api/admin/p/musterstadt/versions')).json();
  expect(versions).toHaveLength(1);
  expect(versions[0]).toMatchObject({
    version: 1,
    status: 'deployed',
    template: 'baumkataster',
    templateVersion: '1.0.0',
  });

  const again = await (await ctx.post('/api/admin/p/musterstadt/deploy', { data: file })).json();
  expect(again).toMatchObject({ ok: true, version: 1, created: false });

  // an overlay deploys against the template published in control.db
  const ov = await ctx.post('/api/admin/p/overlay/deploy', {
    data: golden('projects/musterstadt-plain.yaml'),
  });
  expect(await ov.json()).toMatchObject({ ok: true, version: 1, created: true });
  const ovVersions = await (await ctx.get('/api/admin/p/overlay/versions')).json();
  // extends: baumkataster@1 means any 1.x (settings-lifecycle-info-packs publishes 1.1.0 into the shared control.db)
  expect(ovVersions[0]).toMatchObject({
    template: 'baumkataster',
    templateVersion: expect.stringMatching(/^1\.\d+\.\d+$/),
  });

  const unknown = await ctx.get('/api/admin/p/nowhere/versions');
  expect(unknown.status()).toBe(404);
  const junk = await ctx.post('/api/admin/p/musterstadt/deploy', { data: { hello: 'world' } });
  expect(junk.status()).toBe(400);

  // `/api/auth/logout` ends the participant session; the admin session has its own sign-out (WP-705)
  const out = await ctx.post('/admin/logout', { maxRedirects: 0 });
  expect(out.status()).toBe(303);
  expect((await ctx.get('/api/admin/p/musterstadt/versions')).status()).toBe(401);
  await ctx.dispose();
});
