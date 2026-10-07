import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-325: the Versionen page at /admin/projects/<key>/versions at a phone and a desktop viewport: v3's Releases list
 * plus rollback with the in-app confirm dialog, compare, and "Entwurf verwerfen".
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const VERSIONS = '/admin/projects/versionstadt/versions';
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

test.use({ locale: 'de-DE' });

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

let admins = 0;

/** Signs the admin in at /admin/login with e-mail and password; the page keeps the session cookie. */
async function signIn(page: Page): Promise<void> {
  const email = `versions${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'versionstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'versionstadt', 'Versionen Stadt']).status).toBe(0);
  createAdmin('versionsdeploy@example.org');
  expect(admin(['add-membership', 'versionsdeploy@example.org', 'versionstadt', 'verwaltung']).status).toBe(
    0,
  );
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'versionsdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  // Two versions: the golden overlay, then the same with another label.
  const first = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  expect(await (await ctx.post('/api/admin/p/versionstadt/deploy', { data: first })).json()).toMatchObject({
    ok: true,
    version: 1,
  });
  const second = structuredClone(first) as { override?: Record<string, unknown> };
  second.override = { ...second.override, 'types.baum.label': { de: 'Baum neu', en: 'Tree new' } };
  expect(await (await ctx.post('/api/admin/p/versionstadt/deploy', { data: second })).json()).toMatchObject({
    ok: true,
    version: 2,
  });
  await ctx.dispose();
});

test('anonymous is sent to the sign-in', async ({ page }) => {
  const res = await page.request.get(VERSIONS, { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()['location']).toContain('/admin/login');
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name}: the list, compare, rollback with confirm, Entwurf verwerfen`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    await page.goto(VERSIONS);

    await expect(page.getByRole('heading', { level: 1, name: 'Versionen' })).toBeVisible();
    const rows = page.locator('li[data-version]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('v2');
    await expect(rows.first()).toContainText('aktiv');
    await expect(rows.first().getByRole('button', { name: 'Zurückrollen' })).toHaveCount(0);
    // no horizontal scroll at phone width
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('checkbox', { name: 'Version 1 zum Vergleichen auswählen' }).click();
    await page.getByRole('checkbox', { name: 'Version 2 zum Vergleichen auswählen' }).click();
    await page.getByRole('button', { name: 'Vergleichen', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Änderungen von v1 zu v2' })).toBeVisible();
    await expect(page.getByText('types.baum.label').first()).toBeVisible();

    await rows.nth(1).getByRole('button', { name: 'Zurückrollen' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Auf Version 1 zurückrollen?');
    await dialog.getByRole('button', { name: 'Zurückrollen' }).click();
    await expect(page.getByText('Version 1 ist wieder aktiv.')).toBeVisible();
    await expect(rows.nth(1)).toContainText('aktiv');
    await expect(rows.first().getByRole('button', { name: 'Zurückrollen' })).toBeVisible();

    await page.getByRole('button', { name: 'Entwurf verwerfen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Verwerfen' }).click();
    await expect(page.getByText('Der Entwurf entspricht wieder der aktiven Version.')).toBeVisible();

    // restore version 2 for the other viewport
    await rows.first().getByRole('button', { name: 'Zurückrollen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Zurückrollen' }).click();
    await expect(rows.first()).toContainText('aktiv');
  });
}
