import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { goldenFile } from '../golden';

/**
 * WP-713: English mode against the built process. The Liste headers and the sheet's Daten show the template's English
 * labels and English-formatted dates and numbers (v3 showed the field label in the person's language; its dates followed
 * the browser language). The seeded Veranstaltung is created through the run endpoint, as a device would send it.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KEY = 'enlabelstadt';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
test.use({ ...devices['Desktop Chrome'], locale: 'de-DE' });

/** Unique per run so a repeated run against the same data directory still creates its own admin and run. */
let STAMP = 0;
let EMAIL = '';

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  STAMP = Date.now();
  EMAIL = `labels${STAMP}@example.org`;
  admin(['create-project', KEY, KEY]);
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', EMAIL, KEY, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/veranstaltung/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'veranstaltung@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

const SITE = {
  type: 'Polygon',
  coordinates: [
    [
      [8, 50],
      [8.001, 50],
      [8.001, 50.001],
      [8, 50.001],
      [8, 50],
    ],
  ],
};

test('English mode: Liste headers, Daten labels and dates are English', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ub:locale', 'en'));
  const token = rosterToken(E2E_DATA_DIR, KEY, 'p-applicant', ['antragsteller']);
  expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  const run = await page.request.post(`/api/p/${KEY}/runs`, {
    data: {
      id: `00000000-0000-7000-8000-${String(STAMP % 1e12).padStart(12, '0')}`,
      task: 'beantragen',
      configVersion: 1,
      input: {
        titel: 'Lantern walk',
        datum: '2030-11-03',
        geometrie: {
          type: 'Polygon',
          coordinates: [
            [
              [8, 50],
              [8.001, 50],
              [8.001, 50.001],
              [8, 50.001],
              [8, 50],
            ],
          ],
        },
      },
    },
  });
  expect(run.status()).toBe(200);
  await page.goto('/map');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader', { name: 'Date' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Applicant' })).toBeVisible();
  await expect(table.getByText('Nov 3, 2030').first()).toBeVisible();
  await expect(table.getByText('antragsteller')).toHaveCount(0);
  await table.getByRole('button', { name: 'Lantern walk' }).first().click();
  await page.getByRole('tab', { name: 'Data' }).click();
  const rows = page.getByTestId('daten-property');
  await expect(rows.filter({ hasText: 'Nov 3, 2030' })).toBeVisible();
});

test.describe('WP-761: the Liste names follow a runtime language switch', () => {
  for (const size of [
    { name: 'desktop', viewport: { width: 1280, height: 800 } },
    { name: 'phone', viewport: { width: 390, height: 844 } },
  ]) {
    test(`DE to EN with the Liste open renames fallback rows without navigation (${size.name})`, async ({
      page,
    }, info) => {
      await page.setViewportSize(size.viewport);
      const token = rosterToken(E2E_DATA_DIR, KEY, `p-switch-${size.name}-${info.retry}`, ['antragsteller']);
      expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
      const run = await page.request.post(`/api/p/${KEY}/runs`, {
        data: {
          id: `00000000-0000-7000-8000-${String((STAMP + (size.name === 'phone' ? 1 : 2)) % 1e12).padStart(12, '0')}`,
          task: 'beantragen',
          configVersion: 1,
          // A blank title: the row is named by its type and short id, the part that is localized
          input: { titel: ' ', datum: '2030-11-03', geometrie: SITE },
        },
      });
      expect(run.status()).toBe(200);
      await page.goto('/map');
      const toggle = page.getByRole('button', { name: 'Liste', exact: true });
      await expect(toggle).toBeVisible();
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
      const table = page.getByRole('table');
      await expect(table.getByRole('button', { name: /^Veranstaltung #/ }).first()).toBeVisible();
      await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      const sheet = page.getByRole('dialog', { name: 'Einstellungen' });
      await sheet.getByRole('tab', { name: 'Optionen' }).click();
      await sheet.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(table.getByRole('button', { name: /^Event #/ }).first()).toBeVisible();
      await expect(table.getByRole('button', { name: /^Veranstaltung #/ })).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
    });
  }
});
