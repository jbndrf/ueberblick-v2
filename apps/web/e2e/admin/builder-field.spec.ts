import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-337: v3's Felddefinition in the builder's right pane. Select a property in the catalog's field library,
 * rename it, restrict who sees and edits it, Speichern, reload: it is still there. The same flow at phone and desktop size.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const BUILDER = '/admin/projects/fieldstadt/types/baum/builder';

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
  expect(admin(['create-project', 'fieldstadt', 'Field Stadt']).status).toBe(0);
  createAdmin('fielddeploy@example.org');
  expect(admin(['add-membership', 'fielddeploy@example.org', 'fieldstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'fielddeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/fieldstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/** v3's sign-in (WP-942: the one-time code is off by default); every sign-in is its own admin. */
async function signIn(page: Page): Promise<void> {
  const email = `field${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'fieldstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  {
    name: 'phone',
    width: 390,
    height: 844,
    property: 'hoehe_klasse',
    label: 'Höhenklasse',
    renamed: 'Höhenstufe',
  },
  {
    name: 'desktop',
    width: 1280,
    height: 800,
    property: 'hoehe_m',
    label: 'Höhe (m)',
    renamed: 'Kronenhöhe',
  },
] as const;

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey AB-04: roles on the property, saved and still there after a reload', async ({ page }) => {
      await signIn(page);
      await page.goto(BUILDER);
      const frame = page.getByTestId('builder-frame');

      // select the property in the field library: the Felddefinition opens in the right pane
      // (phone: the catalog is a sheet, and the pane opens as a sheet when the property is selected)
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.locator(`[data-path="types.baum.properties.${size.property}"]`).click();
      const pane = page.getByTestId('field-pane');
      await expect(pane).toBeVisible();
      await expect(pane.getByTestId('field-label')).toHaveValue(size.label);
      await expect(pane.getByTestId('field-key')).toHaveText(size.property);

      // rename it
      await pane.getByTestId('field-label').fill(size.renamed);
      await pane.getByTestId('field-label').blur();

      // Sichtbar für = Baumkontrolle (v3's select: a dialog on a phone, a popover on a desktop)
      await pane.getByTestId('field-see').getByRole('button').first().click();
      if (size.name === 'phone') {
        const dialog = page.getByRole('dialog', { name: 'Sichtbar für Rollen' });
        await expect(dialog).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(size.width - 1);
        await dialog.getByRole('checkbox', { name: /Baumkontrolle/ }).click();
        await dialog.getByRole('button', { name: 'Fertig (1)' }).click();
        await expect(dialog).toBeHidden();
      } else {
        await page
          .getByRole('listbox')
          .getByRole('option', { name: /Baumkontrolle/ })
          .click();
        await page.keyboard.press('Escape');
      }
      await expect(pane.getByTestId('field-see').getByRole('button').first()).toContainText('Baumkontrolle');

      // Bearbeitbar für: Bauhof joins the role that already edits it
      await pane.getByTestId('field-write').getByRole('button').first().click();
      if (size.name === 'phone') {
        const dialog = page.getByRole('dialog', { name: 'Bearbeitbar für Rollen' });
        await dialog.getByRole('checkbox', { name: 'Bauhof', exact: true }).click();
        await dialog.getByRole('button', { name: /Fertig/ }).click();
      } else {
        await page.getByRole('listbox').getByRole('option', { name: 'Bauhof', exact: true }).click();
        await page.keyboard.press('Escape');
      }
      await expect(pane.getByTestId('field-write').getByRole('button').first()).toContainText('Bauhof');

      await expect(frame.getByTestId('unsaved')).toBeVisible();
      // phone: close the inspector sheet first (the selection stays), the toolbar is behind its overlay
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(frame.getByTestId('unsaved')).toBeHidden();

      // after a reload the draft holds the same: the property under its new name, with the roles
      await page.reload();
      if (size.name === 'phone') await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.locator(`[data-path="types.baum.properties.${size.property}"]`).click();
      const again = page.getByTestId('field-pane');
      await expect(again.getByTestId('field-label')).toHaveValue(size.renamed);
      await expect(again.getByTestId('field-see').getByRole('button').first()).toContainText('Baumkontrolle');
      await expect(again.getByTestId('field-write').getByRole('button').first()).toContainText('Bauhof');
    });

    test('options of a select: add, rename (the key stays), remove shows the hint', async ({ page }) => {
      await signIn(page);
      await page.goto(BUILDER);
      const frame = page.getByTestId('builder-frame');
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.locator('[data-path="types.baum.properties.vitalitaet"]').click();
      const pane = page.getByTestId('field-pane');
      await expect(pane.locator('[data-option="v2"]')).toBeVisible();

      await pane.getByTestId('field-option-new').fill('Abgestorben');
      await pane.getByRole('button', { name: 'Option hinzufügen' }).click();
      await expect(pane.locator('[data-option="abgestorben"]')).toBeVisible();

      await pane.getByRole('button', { name: '2 umbenennen' }).click();
      await pane.getByRole('textbox', { name: '2 umbenennen' }).fill('zwei');
      await page.keyboard.press('Enter');
      await expect(pane.locator('[data-option="v2"]')).toContainText('zwei');

      await pane.getByRole('button', { name: 'zwei nach oben verschieben' }).click();
      await expect(pane.locator('[data-option]').nth(1)).toHaveAttribute('data-option', 'v2');

      await pane.getByRole('button', { name: 'Abgestorben entfernen' }).click();
      await expect(pane.locator('[data-option="abgestorben"]')).toHaveCount(0);
      await expect(page.getByTestId('option-removed')).toContainText('verschieben nach');
    });
  });
}
