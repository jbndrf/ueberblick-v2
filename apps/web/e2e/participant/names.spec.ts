import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { importParticipant, openProjectDb } from '@ueberblick/server';
import { rosterToken } from '../seed';
import { goldenFile } from '../golden';
import { uniqueEmail } from '../admin/sign-in';

/**
 * WP-723: a participant value is shown by the person's name, never the id. The applicant "p-olga" is seeded with the
 * name "Olga Beispiel"; the Liste cell and the sheet's Daten row of the Veranstaltung she filed (`beantragen` sets
 * `antragsteller` to her id) read her name (v3 showed the name of a participant field). A Ordnungsamt participant
 * (another actor) reads it too, from the `people` of her sync; an applicant the device has no name for reads "Jemand",
 * never the id. Built process.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KEY = 'namenstadt';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const { defaultBrowserType: _unused, ...PIXEL } = devices['Pixel 7'];
void _unused;

function admin(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout, err: r.stderr };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  // Repeated runs (--repeat-each) meet the project of the first: its setup is done once.
  const project = admin(['create-project', KEY, KEY]);
  if (project.status !== 0) {
    if (/UNIQUE constraint failed: projects\.key/.test(project.err)) return;
    throw new Error(`create-project failed (${project.status}): ${project.out}${project.err}`);
  }
  // admin/data-actor-names.spec.ts shares this data directory and once took 'namen@example.org': a unique e-mail
  const email = uniqueEmail('namen');
  const created = admin(['create-admin', email]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', email, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', email, KEY, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/veranstaltung/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'veranstaltung@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

function olga(): string {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    importParticipant(
      { db, now: () => new Date() },
      { id: 'p-olga', roles: ['antragsteller'], name: 'Olga Beispiel' },
    );
  } finally {
    db.close();
  }
  return rosterToken(E2E_DATA_DIR, KEY, 'p-olga', ['antragsteller']);
}

const POLYGON = {
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

async function file(page: Page, token: string, runId: string, titel: string): Promise<void> {
  expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  const run = await page.request.post(`/api/p/${KEY}/runs`, {
    data: {
      id: runId,
      task: 'beantragen',
      configVersion: 1,
      input: { titel, datum: '2030-11-03', geometrie: POLYGON },
    },
  });
  expect(run.status()).toBe(200);
}

/** A fresh browser context per look, so the Liste starts closed whoever looked before. */
async function openDaten(
  browser: Browser,
  baseURL: string,
  token: string,
  titel: string,
  screen: object,
): Promise<Page> {
  const context = await browser.newContext({ ...screen, locale: 'de-DE', baseURL });
  const page = await context.newPage();
  expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  await page.goto('/map');
  const toggle = page.getByRole('button', { name: 'Liste', exact: true });
  await expect(toggle).toBeVisible();
  // Whether the Liste starts open is the device's own memory: open it only when it is closed.
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await page.getByRole('table').getByRole('button', { name: titel }).first().click();
  await page.getByRole('tab', { name: 'Daten' }).click();
  return page;
}

const SIZES = [
  ['phone', PIXEL],
  ['desktop', { viewport: { width: 1280, height: 800 } }],
] as const;
for (const [size, screen] of SIZES) {
  test.describe(size, () => {
    test.use({ ...screen, locale: 'de-DE' });

    test('Liste and Daten show the applicant by name, not by id', async ({ page, browser, baseURL }) => {
      const token = olga();
      await file(page, token, '00000000-0000-7000-8000-000000000723', 'Laternenumzug');
      const own = await openDaten(browser, baseURL ?? '', token, 'Laternenumzug', screen);
      await expect(own.getByRole('table').getByText('Olga Beispiel').first()).toBeVisible();
      await expect(own.getByRole('table').getByText('p-olga')).toHaveCount(0);
      await expect(own.getByTestId('daten-property').filter({ hasText: 'Olga Beispiel' })).toBeVisible();
      await expect(own.getByRole('tabpanel')).not.toContainText('p-olga');
    });

    test('another actor reads the applicant by name, an unnamed one as Jemand', async ({
      page,
      browser,
      baseURL,
    }) => {
      await file(page, olga(), '00000000-0000-7000-8000-000000000723', 'Laternenumzug');
      await file(
        page,
        rosterToken(E2E_DATA_DIR, KEY, 'p-fremd', ['antragsteller']),
        '00000000-0000-7000-8000-000000000724',
        'Strassenfest',
      );
      const sven = rosterToken(E2E_DATA_DIR, KEY, 'p-sven', ['sachbearbeiter']);
      const named = await openDaten(browser, baseURL ?? '', sven, 'Laternenumzug', screen);
      await expect(named.getByRole('table').getByText('Olga Beispiel').first()).toBeVisible();
      await expect(named.getByTestId('daten-property').filter({ hasText: 'Olga Beispiel' })).toBeVisible();
      await expect(named.getByRole('tabpanel')).not.toContainText('p-olga');
      const unnamed = await openDaten(browser, baseURL ?? '', sven, 'Strassenfest', screen);
      await expect(unnamed.getByTestId('daten-property').filter({ hasText: 'Jemand' })).toBeVisible();
      await expect(unnamed.getByRole('tabpanel')).not.toContainText('p-fremd');
      await expect(unnamed.getByRole('table')).not.toContainText('p-fremd');
    });
  });
}
