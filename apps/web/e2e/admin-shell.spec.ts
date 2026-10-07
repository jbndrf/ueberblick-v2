import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { scan } from '../../../e2e/a11y/axe';
import { E2E_DATA_DIR } from '../playwright.config';
import { goldenFile } from './golden';

/** WP-320 (was WP-180's sign-in spec): an admin signs in at /admin/login and lands in v3's admin shell. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';

// axe is injected as a script; the CSP itself is asserted in security-headers.spec.ts.
test.use({ bypassCSP: true, locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

/** Creates an admin account (the e2e server has `ADMIN_TOTP=off`: no code to confirm). */
function createAdmin(email: string): void {
  expect(admin(['create-admin', email]).status).toBe(0);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'signinstadt', 'Sign-in Stadt']).status).toBe(0);
  createAdmin('signin@example.org');
  expect(admin(['add-membership', 'signin@example.org', 'signinstadt', 'verwaltung']).status).toBe(0);
  createAdmin('nomember@example.org');
  createAdmin('deployer@example.org');
  expect(admin(['add-membership', 'deployer@example.org', 'signinstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  // the builder shows a project file only once a version is deployed
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: {
      email: 'deployer@example.org',
      password: PASSWORD,
    },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/signinstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

// ADMIN_TOTP is off in the e2e server (the default): e-mail and password only, no code field.
async function fillForm(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}
const sessionCookies = async (page: Page) =>
  (await page.context().cookies()).filter((c) => c.name.toLowerCase().includes('session'));

test('there is no start page: / leads anonymous visitors to the participant sign-in (WP-608)', async ({
  page,
}) => {
  const res = await page.request.get('/', { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()['location']).toBe('/login');
  await page.goto('/admin/login');
  await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
});

test('journey: redirect to sign-in, sign in, shell, project page, theme, language, sign out', async ({
  page,
}) => {
  // signed out, a visit is redirected (303) and keeps where it was going
  const first = await page.request.get('/admin/projects', { maxRedirects: 0 });
  expect(first.status()).toBe(303);
  expect(first.headers()['location']).toBe('/admin/login?redirectTo=%2Fadmin%2Fprojects');
  await page.goto('/admin/projects');
  await expect(page).toHaveURL(/\/admin\/login\?redirectTo=%2Fadmin%2Fprojects$/);
  expect(await scan(page)).toEqual([]);

  // after sign-in the admin lands on the page they asked for, inside the shell
  await fillForm(page, 'signin@example.org');
  await expect(page).toHaveURL(/\/admin\/projects$/);
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar.getByRole('link', { name: 'Projekte' })).toBeVisible();
  await expect(sidebar.getByText('Ihre Projekte')).toBeVisible();
  expect((await page.locator('header').boundingBox())?.height).toBe(40);
  expect(await scan(page)).toEqual([]);

  // a project: its pages in the sidebar, the participants page inside the shell (WP-320's placeholder is gone, WP-324)
  await sidebar.getByRole('link', { name: 'Sign-in Stadt' }).click();
  await expect(page).toHaveURL(/\/admin\/projects\/signinstadt\/settings$/);
  await expect(sidebar.getByRole('link', { name: 'Versionen' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Objektarten' })).toBeVisible();
  await sidebar.getByRole('link', { name: 'Teilnehmende' }).click();
  await expect(page).toHaveURL(/\/admin\/projects\/signinstadt\/participants$/);
  await expect(page.getByRole('heading', { name: 'Teilnehmende' })).toBeVisible();

  // the account menu: e-mail, theme (kept after a reload), language
  await page.getByRole('button', { name: 'Konto' }).click();
  await expect(page.getByText('signin@example.org')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Design' }).click();
  await page.getByRole('menuitem', { name: 'Dunkel' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Konto' }).click();
  await page.getByRole('menuitem', { name: 'Design' }).click();
  await page.getByRole('menuitem', { name: 'Hell' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Konto' }).click();
  await page.getByRole('menuitem', { name: 'Sprache' }).click();
  await page.getByRole('menuitem', { name: 'English' }).click();
  await expect(sidebar.getByRole('link', { name: 'Participants' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Language' }).click();
  await page.getByRole('menuitem', { name: 'Deutsch' }).click();
  await expect(sidebar.getByRole('link', { name: 'Teilnehmende' })).toBeVisible();

  // the sidebar folds with its trigger
  await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();

  // sign out ends the session: the login page, no cookie, and the admin area redirects again
  await page.getByRole('button', { name: 'Konto' }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(await sessionCookies(page)).toEqual([]);
  expect((await page.request.get('/admin/projects', { maxRedirects: 0 })).status()).toBe(303);
});

test('the old builder sign-in and project list go to their admin counterparts', async ({ page }) => {
  const login = await page.request.get('/builder/login?next=%2Fbuilder%2Fsigninstadt', { maxRedirects: 0 });
  expect(login.status()).toBe(303);
  expect(login.headers()['location']).toBe('/admin/login?redirectTo=%2Fbuilder%2Fsigninstadt');
  const list = await page.request.get('/builder', { maxRedirects: 0 });
  expect(list.status()).toBe(303);
  expect(list.headers()['location']).toBe('/admin/projects');
});

test('a wrong password shows one message and sets no cookie; the form reflows at 320 px', async ({
  page,
}) => {
  await page.goto('/admin/login');
  await expect(page.getByLabel('Einmalcode')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await fillForm(page, 'signin@example.org', 'wrong wrong wrong');
  await expect(page.getByRole('alert')).toContainText('Die Anmeldung war nicht erfolgreich');
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(await sessionCookies(page)).toEqual([]);
  expect(await scan(page)).toEqual([]);
});

test('"30 Tage angemeldet bleiben" sets the longer session, otherwise it lasts 12 hours', async ({
  page,
}) => {
  const lifetimeHours = async (): Promise<number> => {
    const [c] = await sessionCookies(page);
    return ((c?.expires ?? 0) * 1000 - Date.now()) / 3600_000;
  };
  await page.goto('/admin/login');
  await expect(page.getByLabel('30 Tage angemeldet bleiben')).not.toBeChecked();
  await fillForm(page, 'signin@example.org');
  await expect(page).toHaveURL(/\/admin\/projects$/);
  expect(Math.abs((await lifetimeHours()) - 12)).toBeLessThan(0.1);
  await page.context().clearCookies();
  await page.goto('/admin/login');
  await page.getByLabel('30 Tage angemeldet bleiben').check();
  await fillForm(page, 'signin@example.org');
  await expect(page).toHaveURL(/\/admin\/projects$/);
  expect(Math.abs((await lifetimeHours()) - 30 * 24)).toBeLessThan(0.1);
});

test('redirectTo never leaves the site; an admin without a membership sees an empty project list', async ({
  page,
}) => {
  await page.goto('/admin/login?redirectTo=https%3A%2F%2Fevil.example');
  await fillForm(page, 'nomember@example.org');
  await expect(page).toHaveURL(/\/admin\/projects$/);
  await expect(page.getByText('Noch keine Projekte')).toBeVisible();
  expect((await page.request.get('/builder-api/signinstadt/draft')).status()).toBe(403);
});

test('empty sign-in shows the inline errors (v3), the login page itself does not scroll', async ({
  page,
}) => {
  await page.goto('/admin/login');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByText('Ungültige E-Mail-Adresse')).toBeVisible();
  await expect(page.getByText('mindestens 6 Zeichen')).toBeVisible();
  await expect(page.getByLabel('E-Mail')).toHaveClass(/border-destructive/);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  expect(await sessionCookies(page)).toEqual([]);
});

test('signing out in one tab sends the other tab to the login page', async ({ page, context }) => {
  await page.goto('/admin/login');
  await fillForm(page, 'signin@example.org');
  await expect(page).toHaveURL(/\/admin\/projects$/);
  const other = await context.newPage();
  await other.goto('/admin/projects');
  await expect(other.locator('[data-slot="sidebar"]')).toBeVisible();
  await page.getByRole('button', { name: 'Konto' }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(other).toHaveURL(/\/admin\/login/);
});

for (const [name, size] of [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 800 }],
] as const) {
  test(`main flow at ${name} size: sign in, open a project, account menu, sign out`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/admin/login');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await fillForm(page, 'signin@example.org');
    await expect(page).toHaveURL(/\/admin\/projects$/);
    const phone = size.width < 768;
    if (phone) {
      // the sidebar is a sheet: the trigger opens it, it keeps its place across navigation (as v3)
      await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('link', { name: 'Projekte' })).toBeVisible();
      await expect(sheet.getByText('Ihre Projekte')).toBeVisible();
      await sheet.getByRole('link', { name: 'Sign-in Stadt' }).click();
      await expect(page).toHaveURL(/\/admin\/projects\/signinstadt\/settings$/);
      await expect(sheet.getByRole('link', { name: 'Versionen' })).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      await page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Sign-in Stadt' }).click();
      await expect(page).toHaveURL(/\/admin\/projects\/signinstadt\/settings$/);
    }
    await page.getByRole('button', { name: 'Konto' }).click();
    await expect(page.getByText('signin@example.org')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
}
