import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData, goldenFile } from '../golden';

/**
 * WP-361 (S3-10): v3's "QR exportieren (n)" and the copy button of the Zugangstoken cell, at phone (390x844) and desktop
 * (1280x800) size: tick 3 rows, the button counts 3, the PDF holds 3 badges, and every copied login link signs its person in.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const KEY = 'qrcrew';
const PAGE = `/admin/projects/${KEY}/participants`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1 };
}

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'QR Crew']).status).toBe(0);
  expect(admin(['create-admin', 'qr-deploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'qr-deploy@example.org', KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'qr-deploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `qr${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: tick 3 rows, QR exportieren (3), copy a link per row and sign in with it', async ({
      page,
      context,
      request,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await signIn(page);
      const names = ['Alma', 'Berta', 'Cem'].map((n) => `${n} ${size.name}`);
      for (const name of names) {
        const made = await page.request.post(`/api/admin/p/${KEY}/participants`, {
          data: { name, roles: [] },
          headers: { 'sec-fetch-site': 'same-origin' },
        });
        expect(made.ok()).toBe(true);
      }
      await page.goto(PAGE);
      await expect(page.getByRole('button', { name: /^QR exportieren/ })).toHaveCount(0);
      for (const name of names)
        await page
          .getByRole('row', { name: new RegExp(name) })
          .getByRole('checkbox', { name: 'Zeile auswählen' })
          .check();
      const button = page.getByRole('button', { name: 'QR exportieren (3)' });
      await expect(button).toBeVisible();

      const download = page.waitForEvent('download');
      await button.click();
      const file = await download;
      expect(file.suggestedFilename()).toBe('participants-qr-codes.pdf');
      const pdf = (await readFile(await file.path())).toString('latin1');
      expect(pdf.startsWith('%PDF')).toBe(true);
      expect(pdf.match(/\/Type\s*\/Page(?![s\w])/g)).toHaveLength(1);
      for (const name of names) expect(pdf).toContain(`(${name}) Tj`);
      await expect(page.getByText('QR-Code PDF erfolgreich exportiert')).toBeVisible();

      // The link of every row (what the badge's QR holds) signs that person in.
      for (const name of names) {
        const row = page.getByRole('row', { name: new RegExp(name) });
        await row.getByRole('button', { name: 'Kopieren' }).click();
        const link = await page.evaluate(() => navigator.clipboard.readText());
        expect(link).toMatch(/\/login\?token=[A-Z0-9-]+$/);
        const token = new URL(link).searchParams.get('token') ?? '';
        const exchange = await request.post('/api/auth/exchange', { data: { token } });
        expect(exchange.status()).toBe(200);
      }
    });
  });
}
