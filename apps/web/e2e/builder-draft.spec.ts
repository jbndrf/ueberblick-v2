import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../playwright.config';
import { rosterToken } from './seed';
import { goldenFile } from './golden';

/** WP-213: the builder's working draft over the real process (A-011). */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
/** The Objektart builder of the golden project (v3's builder, the only builder page). */
const BUILDER_PAGE = '/admin/projects/draftstadt/types/baum/builder';

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

let overlaySrc = '';
let ctx: APIRequestContext;
let secretOfLonely: Uint8Array;

test.beforeAll(async ({ playwright, baseURL }) => {
  for (const key of ['draftstadt', 'leerstadt']) expect(admin(['create-project', key, key]).status).toBe(0);
  const created = admin(['create-admin', 'draft@example.org']);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', 'draft@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  for (const key of ['draftstadt', 'leerstadt'])
    expect(admin(['add-membership', 'draft@example.org', key, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  // an admin of leerstadt only: must not reach the draft of draftstadt
  const lonely = admin(['create-admin', 'lonely@example.org']);
  secretOfLonely = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(lonely.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', 'lonely@example.org', totpAt(secretOfLonely, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'lonely@example.org', 'leerstadt', 'verwaltung']).status).toBe(0);

  ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'draft@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  overlaySrc = readFileSync(OVERLAY, 'utf8');
  const deploy = await ctx.post('/api/admin/p/draftstadt/deploy', { data: parse(overlaySrc) });
  expect(await deploy.json()).toMatchObject({ ok: true });
});
test.afterAll(async () => ctx.dispose());

test('anonymous is 401, a participant is 403', async ({ request, playwright, baseURL }) => {
  expect((await request.get('/builder-api/draftstadt/draft')).status()).toBe(401);
  const token = rosterToken(E2E_DATA_DIR, 'draftstadt', 'p-1');
  const p = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await p.post('/api/auth/exchange', { data: { token } });
  expect((await p.get('/builder-api/draftstadt/draft')).status()).toBe(401);
  expect(
    (await p.put('/builder-api/draftstadt/draft', { data: { overlay: 'x', revision: 1 } })).status(),
  ).toBe(401);
  await p.dispose();
});

test('a project with no deployed version has no draft to create: 404 no_version', async () => {
  const r = await ctx.get('/builder-api/leerstadt/draft');
  expect(r.status()).toBe(404);
  expect(await r.json()).toMatchObject({ code: 'no_version' });
});

test('first GET seeds from the deployed version; PUT is compare-and-swap', async () => {
  const first = await ctx.get('/builder-api/draftstadt/draft');
  expect(first.status()).toBe(200);
  const draft = await first.json();
  // the overlay says baumkataster@1: any 1.x (settings-lifecycle-info-packs publishes 1.1.0 into the shared control.db)
  expect(draft).toMatchObject({
    revision: 1,
    template: 'baumkataster',
    templateVersion: expect.stringMatching(/^1\.\d+\.\d+$/),
  });
  expect(parse(draft.overlay)).toEqual(parse(overlaySrc));

  const ok = await ctx.put('/builder-api/draftstadt/draft', {
    data: { overlay: `${draft.overlay}# edited\n`, revision: 1 },
  });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ revision: 2 });

  const stale = await ctx.put('/builder-api/draftstadt/draft', {
    data: { overlay: 'mine', revision: 1 },
  });
  expect(stale.status()).toBe(409);
  const body = await stale.json();
  expect(body).toMatchObject({ code: 'stale_revision', draft: { revision: 2 } });
  expect(body.draft.overlay).toContain('# edited');

  // the problems route reads the same draft
  const problems = await ctx.get('/builder-api/draftstadt/problems');
  expect(problems.status()).toBe(200);
});

test('an edit survives a reload', async () => {
  const current = await (await ctx.get('/builder-api/draftstadt/draft')).json();
  const edited = (current.overlay as string).replace('Regelkontrolle', 'Sonderkontrolle');
  expect(edited).not.toBe(current.overlay);
  const put = await ctx.put('/builder-api/draftstadt/draft', {
    data: { overlay: edited, revision: current.revision },
  });
  expect(put.status()).toBe(200);

  // the server-rendered Objektart builder page carries the stored edit, on every load
  for (let load = 0; load < 2; load++) {
    const html = await (await ctx.get(BUILDER_PAGE)).text();
    expect(html).toContain('Sonderkontrolle');
    expect(html).not.toContain('Regelkontrolle');
  }
});

test('an admin of another project gets 403 on GET and PUT, and the draft stays as it was', async ({
  playwright,
  baseURL,
}) => {
  const before = await (await ctx.get('/builder-api/draftstadt/draft')).json();
  const other = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await other.post('/api/auth/login', {
    data: {
      email: 'lonely@example.org',
      password: PASSWORD,
      totp: totpAt(secretOfLonely, Date.now() + STEP_MS),
    },
  });
  expect(login.status()).toBe(200);
  expect((await other.get('/builder-api/draftstadt/draft')).status()).toBe(403);
  const put = await other.put('/builder-api/draftstadt/draft', {
    data: { overlay: 'hijacked', revision: before.revision },
  });
  expect(put.status()).toBe(403);
  expect((await other.get('/builder-api/draftstadt/problems')).status()).toBe(403);
  expect(await (await ctx.get('/builder-api/draftstadt/draft')).json()).toEqual(before);
  await other.dispose();
});

test('in a real browser: the builder opens on the draft and an edit made elsewhere is there after a reload', async ({
  browser,
  baseURL,
}) => {
  const page = await browser.newPage({
    baseURL: baseURL ?? '',
    locale: 'de-DE',
    storageState: await ctx.storageState(),
  });
  await page.goto(BUILDER_PAGE);
  await expect(page.getByTestId('builder-frame')).toBeVisible();
  const current = await (await ctx.get('/builder-api/draftstadt/draft')).json();
  const edited = (current.overlay as string).replace('Sonderkontrolle', 'Sichtkontrolle');
  expect(edited).not.toBe(current.overlay);
  // the browser's own session writes the edit (no editing lens exists yet to click)
  const status = await page.evaluate(
    async ({ overlay, revision }) =>
      (
        await fetch('/builder-api/draftstadt/draft', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ overlay, revision }),
        })
      ).status,
    { overlay: edited, revision: current.revision as number },
  );
  expect(status).toBe(200);
  await page.reload();
  await expect(page.getByTestId('builder-frame').getByText('Sichtkontrolle').first()).toBeVisible();
  await expect(page.getByTestId('builder-frame').getByText('Sonderkontrolle')).toHaveCount(0);
  await page.close();
});
