import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-378: the Felder and Aufgaben tabs of the builder's Modell view (v3 FieldHub and the task table). The admin finds
 * every field with where it is used, searches, opens a Felddefinition, adds a field (it starts in Ausgeblendet),
 * and opens a task from the table. The same flow at phone and desktop size.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const BUILDER = '/admin/projects/modellstadt/types/baum/builder';

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

function createAdmin(email: string): void {
  expect(admin(['create-admin', email]).status).toBe(0);
}

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'modellstadt', 'Modell Stadt']).status).toBe(0);
  createAdmin('modelldeploy@example.org');
  expect(admin(['add-membership', 'modelldeploy@example.org', 'modellstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'modelldeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/modellstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `modell${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'modellstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

const card = (page: Page, key: string): Locator => page.locator(`[data-field="${key}"]`);

async function openModel(page: Page): Promise<Locator> {
  await page.goto(BUILDER);
  const frame = page.getByTestId('builder-frame');
  await frame.getByRole('button', { name: 'Modell', exact: true }).click();
  await expect(page).toHaveURL(/view=model/);
  const hub = page.getByTestId('field-hub');
  await expect(hub).toBeVisible();
  return hub;
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('Felder: every field with where it is used, search, open the Felddefinition', async ({ page }) => {
      await signIn(page);
      const hub = await openModel(page);
      await expect(page.getByRole('tab', { name: 'Felder', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(card(page, 'befund')).toBeVisible();
      await expect(card(page, 'befund').getByTestId('used-in')).toContainText('Aufgaben');
      await expect(card(page, 'intern_notiz').getByTestId('used-in')).toContainText('Nicht verwendet');
      await expect(card(page, 'geometrie')).toHaveCount(0);

      await hub.getByRole('searchbox', { name: 'Felder suchen' }).fill('höhe');
      await expect(card(page, 'hoehe_m')).toBeVisible();
      await expect(card(page, 'befund')).toHaveCount(0);
      await expect(hub.getByRole('status')).toHaveText('2 Treffer');

      await card(page, 'hoehe_m')
        .getByRole('button', { name: /Felddefinition öffnen/ })
        .click();
      await expect(page.getByTestId('field-pane')).toBeVisible();
      await expect(page.getByTestId('field-pane')).toHaveAttribute(
        'data-path',
        'types.baum.properties.hoehe_m',
      );
    });

    test('Felder: a new field starts in Ausgeblendet; showing and hiding moves it', async ({ page }) => {
      await signIn(page);
      const hub = await openModel(page);
      await hub.getByRole('button', { name: 'Feld hinzufügen' }).click();
      await expect(page.getByTestId('field-pane')).toBeVisible();
      await expect(page.getByTestId('field-pane')).toHaveAttribute(
        'data-path',
        'types.baum.properties.neues_feld',
      );
      await expect(hub.getByRole('tab', { name: /Ausgeblendet \(1\)/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      // on a phone the pane is a sheet over the hub (WP-345)
      if (size.width < 768) await page.keyboard.press('Escape');
      await expect(card(page, 'neues_feld')).toBeVisible();

      await card(page, 'neues_feld').getByRole('button', { name: 'Auf Daten-Tab anzeigen' }).click();
      await hub.getByRole('tab', { name: 'Daten', exact: true }).click();
      await expect(card(page, 'neues_feld')).toBeVisible();
      await card(page, 'neues_feld').getByRole('button', { name: 'Aus Daten-Tabs ausblenden' }).click();
      await expect(hub.getByRole('tab', { name: /Ausgeblendet \(1\)/ })).toBeVisible();
    });

    test('Felder: a field has a grip and no up/down buttons; position and tab are set in the arrange disclosure', async ({
      page,
    }) => {
      await signIn(page);
      const hub = await openModel(page);
      const order = (): Promise<(string | null)[]> =>
        page
          .locator('.layout-row [data-field]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-field')));
      const [a] = await order();
      const first = card(page, a as string);
      // a moved card is drawn again (in its new line), so its disclosure is opened before each step
      const open = async (): Promise<void> => {
        const details = first.getByTestId('arrange');
        if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open)))
          await details.locator('summary').click();
      };
      // WP-1057: the up/down buttons are gone, the grip moves a field
      await expect(first.getByTestId('field-grip')).toBeVisible();
      await expect(first.getByRole('button', { name: /nach (unten|oben)/ })).toHaveCount(0);
      await open();
      await first.getByRole('combobox', { name: /Position von/ }).selectOption('left');
      await open();
      await first
        .getByRole('combobox', { name: 'In Tab verschieben' })
        .selectOption({ label: 'Ausgeblendet' });
      await expect(card(page, a as string)).toHaveCount(0);
      await expect(hub.getByRole('tab', { name: /Ausgeblendet \(1\)/ })).toBeVisible();
    });

    test('Aufgaben: the table lists the tasks with Phase and roles; a row opens the task pane', async ({
      page,
    }) => {
      await signIn(page);
      await openModel(page);
      await page.getByRole('tab', { name: 'Aufgaben', exact: true }).click();
      const table = page.getByRole('table', { name: 'Aufgaben der Objektart' });
      await expect(table).toBeVisible();
      for (const h of ['Name', 'Angeboten in Phase', 'Wer darf dies nutzen', 'Formularfelder']) {
        await expect(table.getByRole('columnheader', { name: h })).toBeVisible();
      }
      const row = table.locator('[data-task="kontrolle"]');
      await expect(row).toContainText('Baumkontrolle');
      await row.getByRole('button').click();
      await expect(page.getByTestId('task-pane')).toBeVisible();
      await expect(page.getByTestId('task-pane')).toHaveAttribute('data-task', 'kontrolle');
    });
  });
}
