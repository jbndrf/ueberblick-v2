import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-462: "Verknüpftes Feld hinzufügen" (WP-449, owner A5) in the real form editor at desktop and phone size: the
 * task `kontrolle` binds `area` (the Fläche); the picker offers the bind, then its properties; a pick adds the card
 * with its origin badge; Speichern, reload: the field stayed.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/linkstadt/types/baum/builder';

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'linkstadt', 'Link Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'linkdeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'linkdeploy@example.org', 'linkstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'linkdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/linkstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `link${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'linkstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, property: 'name' },
  { name: 'phone', viewport: { width: 390, height: 844 }, property: 'letzte_kontrolle' },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: size.name === 'phone' });

    test('journey: add a linked field from the bound Objektart, Speichern, reload', async ({ page }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const openEditor = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator('[data-path="tasks.kontrolle"]').click();
        const pane = page.getByTestId('task-pane');
        await pane.getByTestId('tab-form').click();
        await pane.getByTestId('step-0-edit').click();
        await expect(page.getByTestId('form-editor')).toBeVisible();
      };
      await openEditor();
      const key = `area.${size.property}`;
      await expect(page.locator(`[data-key="${key}"]`)).toHaveCount(0);

      // Step 1: the relation (the task's bind); step 2: a property of the Objektart it yields
      await page.getByTestId('linked-add').click();
      const picker = page.getByTestId('linked-picker');
      await expect(picker).toBeVisible();
      await picker.getByTestId('linked-bind-area').click();
      await expect(picker.getByTestId('linked-field-geometrie')).toHaveCount(0);
      await picker.getByTestId(`linked-field-${size.property}`).click();
      await expect(picker).toBeHidden();

      // The card carries the origin badge (the Fläche)
      const card = page.locator(`[data-key="${key}"]`);
      await expect(card).toHaveCount(1);
      await expect(card.getByTestId('field-origin')).toContainText('Fläche');

      // A field that is in the form is greyed when the picker opens again
      await page.getByTestId('linked-add').click();
      await page.getByTestId('linked-bind-area').click();
      await expect(page.getByTestId(`linked-field-${size.property}`)).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(picker).toBeHidden();

      // WP-494 (v3 FormPreview.svelte:189-210): width works for a linked field, as for any other
      if (size.name === 'desktop') await card.hover();
      await card.getByTestId('field-width-left').click();
      await expect(card).toHaveAttribute('data-column', 'left');

      // WP-494 (v3 FieldConfigPanel.svelte:562-620): Platzhalter and Hilfetext in the linked field's panel
      await card.dispatchEvent('click');
      const panel = page.getByTestId('linked-config');
      await panel.getByTestId('cfg-placeholder').fill('Name der Fläche');
      await panel.getByTestId('cfg-help').fill('Wie die Fläche heißt');
      await panel.getByTestId('cfg-help').blur();
      await panel.getByTestId('form-field-back').click();
      await card.dispatchEvent('click');
      await expect(page.getByTestId('cfg-placeholder')).toHaveValue('Name der Fläche');
      await expect(page.getByTestId('cfg-help')).toHaveValue('Wie die Fläche heißt');
      await page.getByTestId('form-field-back').click();

      // Speichern, reload: the linked field stayed
      await expect(page.getByTestId('unsaved')).toBeVisible();
      // phone: the editor is a sheet over the frame; close it to reach Speichern
      if (size.name === 'phone') {
        await page.getByTestId('form-close').click();
        await page.keyboard.press('Escape');
      }
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      await openEditor();
      await expect(page.locator(`[data-key="${key}"]`)).toHaveCount(1);
    });
  });
}
