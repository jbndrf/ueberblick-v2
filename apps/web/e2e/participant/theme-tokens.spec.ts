import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { goldenFile } from '../golden';

/**
 * WP-714 (desktop hunt finding 9): the `--ub-*` tokens of the role's theme reach every participant surface, against the
 * built process: the sign-in page (no role yet), the map and a portalled list box (bits-ui renders it into `<body>`).
 * Outdoor is a role's `app.ui.theme`; the tokens follow it without a reload.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PASSWORD = 'correct horse battery';
const EMAIL = 'theme@example.org';
const STEP_MS = 30_000;
const NORMAL = { key: 'themenormal', text: '#1a1f1c' };
const OUTDOOR = { key: 'themeoutdoor', text: '#000000' };
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
const SCREENS = [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? 'otpauth://x/y?secret=').searchParams.get('secret') ??
      '',
  );
  if (created.status === 0) expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/maengelmelder/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  for (const [i, p] of [NORMAL, OUTDOOR].entries()) {
    admin(['create-project', p.key, p.key]);
    expect(admin(['add-membership', EMAIL, p.key, 'verwaltung']).status).toBe(0);
    const login = await ctx.post('/api/auth/login', {
      data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + (i + 1) * STEP_MS) },
    });
    expect(login.status()).toBe(200);
    const overlay =
      p === OUTDOOR
        ? {
            schema: 'ueberblick/1',
            extends: 'maengelmelder@1',
            add: { 'roles.melder.app.ui': { theme: 'outdoor' } },
          }
        : { schema: 'ueberblick/1', extends: 'maengelmelder@1' };
    const deploy = await ctx.post(`/api/admin/p/${p.key}/deploy`, { data: overlay });
    const body: unknown = await deploy.json();
    expect(JSON.stringify(body)).toContain('"ok":true');
  }
  await ctx.dispose();
});

const token = (page: Page, el: string): Promise<string> =>
  page.evaluate(
    (sel) =>
      getComputedStyle(document.querySelector(sel) as Element)
        .getPropertyValue('--ub-color-text')
        .trim(),
    el,
  );

for (const [name, screen] of SCREENS) {
  test.describe(name, () => {
    test.use(screen);
    for (const p of [NORMAL, OUTDOOR]) {
      test(`${p.key}: sign-in page, map and a portalled list box carry the theme's tokens`, async ({
        page,
      }) => {
        await page.goto('/login');
        // the sign-in page has no role yet: the normal theme
        await expect.poll(() => token(page, 'body')).toBe(NORMAL.text);

        const t = rosterToken(E2E_DATA_DIR, p.key, `p-${p.key}`, ['melder']);
        expect((await page.request.post('/api/auth/exchange', { data: { token: t } })).status()).toBe(200);
        await page.goto('/map');
        await page.getByRole('button', { name: 'Neu' }).first().click();
        await page.getByTestId('create-pill').first().click();
        await page.getByTestId('placement-confirm').click();
        await page.getByLabel('Kategorie').click();
        const option = page.getByText('Beleuchtung', { exact: true });
        await expect(option).toBeVisible();
        // really portalled: outside the map's own tree
        expect(await option.evaluate((e) => e.closest('.app') === null)).toBe(true);
        const value = await option.evaluate((e) =>
          getComputedStyle(e).getPropertyValue('--ub-color-text').trim(),
        );
        expect(value).toBe(p.text);
        await expect.poll(() => token(page, 'body')).toBe(p.text);
      });
    }
  });
}
