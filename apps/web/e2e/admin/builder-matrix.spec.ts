import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-331: v3's "Berechtigungen" matrix in the builder's Modell view. The admin changes who edits a property in
 * the matrix, sees the same in the property's own pane (AB-05), saves, reloads and finds it again; a cell the
 * draft changed can be reset; "Private Objekte" writes the row filter. The same flow at phone and desktop size.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const BUILDER = '/admin/projects/matrixstadt/types/baum/builder';

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
  expect(admin(['create-project', 'matrixstadt', 'Matrix Stadt']).status).toBe(0);
  createAdmin('matrixdeploy@example.org');
  expect(admin(['add-membership', 'matrixdeploy@example.org', 'matrixstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'matrixdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/matrixstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `matrix${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'matrixstadt', 'verwaltung']).status).toBe(0);
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

const row = (page: Page, id: string): Locator => page.locator(`[data-row="${id}"]`);
const cell = (page: Page, id: string, role: string): Locator =>
  row(page, id).getByRole('checkbox', { name: new RegExp(`^${role}:`) });

async function openMatrix(page: Page): Promise<Locator> {
  await page.goto(BUILDER);
  const frame = page.getByTestId('builder-frame');
  await frame.getByRole('button', { name: 'Modell', exact: true }).click();
  await expect(page).toHaveURL(/view=model/);
  await page.getByRole('tab', { name: 'Berechtigungen' }).click();
  const matrix = page.getByTestId('permission-matrix');
  await expect(matrix).toBeVisible();
  return matrix;
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey AB-05: the matrix shows what the property pane sets; a change is saved and reset per cell', async ({
      page,
    }) => {
      await signIn(page);
      const matrix = await openMatrix(page);
      const frame = page.getByTestId('builder-frame');
      await expect(matrix.getByText('Objektart-Berechtigungen')).toBeVisible();
      for (const role of ['Baumkontrolle', 'Bauhof', 'Verwaltung']) {
        await expect(matrix.getByRole('columnheader', { name: role })).toBeVisible();
      }

      // the template says: only the Baumkontrolle edits Höhe (m)
      await expect(cell(page, 'baum.write.hoehe_m', 'Baumkontrolle')).toHaveAttribute('aria-checked', 'true');
      await expect(cell(page, 'baum.write.hoehe_m', 'Bauhof')).toHaveAttribute('aria-checked', 'false');
      // a touch target a thumb can hit on the phone
      const box = await cell(page, 'baum.write.hoehe_m', 'Bauhof').boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(size.name === 'phone' ? 32 : 24);

      // turn Bauhof on: marked as changed, the draft is dirty
      await cell(page, 'baum.write.hoehe_m', 'Bauhof').click();
      await expect(cell(page, 'baum.write.hoehe_m', 'Bauhof')).toHaveAttribute('aria-checked', 'true');
      await expect(row(page, 'baum.write.hoehe_m').getByTestId('matrix-reset')).toHaveCount(1);
      await expect(frame.getByTestId('unsaved')).toBeVisible();

      // the same set in the property's own pane (v3's "Bearbeitbar für Rollen")
      // phone: the catalog is a sheet, and the pane opens as a sheet when the property is selected
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.locator('[data-path="types.baum.properties.hoehe_m"]').click();
      const pane = page.getByTestId('field-pane');
      await expect(pane.getByTestId('field-write').getByRole('button').first()).toContainText('Bauhof');
      if (size.name === 'phone') await page.keyboard.press('Escape'); // close the inspector sheet

      // Speichern, reload: still there
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(frame.getByTestId('unsaved')).toBeHidden();
      await openMatrix(page);
      await expect(cell(page, 'baum.write.hoehe_m', 'Bauhof')).toHaveAttribute('aria-checked', 'true');

      // reset puts the cell back to the template
      await row(page, 'baum.write.hoehe_m').getByTestId('matrix-reset').click();
      await expect(cell(page, 'baum.write.hoehe_m', 'Bauhof')).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('matrix-reset')).toHaveCount(0);
      await page.getByTestId('builder-frame').getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
    });

    test('Erweitert shows Erstellen and Löschen; Private Objekte writes the row filter', async ({ page }) => {
      await signIn(page);
      const matrix = await openMatrix(page);
      await expect(matrix.getByText('Kann Objekte erstellen')).toBeHidden();
      await matrix.getByRole('button', { name: 'Erweitert' }).click();
      await expect(matrix.getByText('Kann Objekte erstellen')).toBeVisible();
      await expect(matrix.getByText('Kann Objekte löschen')).toBeVisible();
      await expect(cell(page, 'baum.create', 'Verwaltung')).toHaveAttribute('aria-checked', 'true');
      await expect(cell(page, 'baum.create', 'Bauhof')).toHaveAttribute('aria-checked', 'false');

      const sw = matrix.getByRole('switch', { name: 'Private Objekte' });
      await expect(sw).toHaveAttribute('aria-checked', 'false');
      await sw.click();
      await expect(sw).toHaveAttribute('aria-checked', 'true');
      const frame = page.getByTestId('builder-frame');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(frame.getByTestId('unsaved')).toBeHidden();

      await openMatrix(page);
      const again = page.getByTestId('permission-matrix').getByRole('switch', { name: 'Private Objekte' });
      await expect(again).toHaveAttribute('aria-checked', 'true');
      await again.click();
      await expect(again).toHaveAttribute('aria-checked', 'false');
      await page.getByTestId('builder-frame').getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
    });
  });
}
