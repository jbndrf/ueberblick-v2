import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-393: v3's Smart Dropdown in the field config panel at desktop (mouse) and phone size (touch, the inspector
 * sheet): the palette tile places a select, Quellfeld is picked from the earlier selects, the dialog's tab per source
 * value takes options, Speichern, reload: the choice filter is as left.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/smartstadt/types/baum/builder';

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
  expect(admin(['create-project', 'smartstadt', 'Smart Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'smartdeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'smartdeploy@example.org', 'smartstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'smartdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/smartstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `smart${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'smartstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: size.touch });

    test('journey: a Smart Dropdown gets a Quellfeld and options per source value; Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const press = async (target: Locator): Promise<void> => (size.touch ? target.tap() : target.click());
      const openEditor = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator('[data-path="tasks.kontrolle"]').click();
        const pane = page.getByTestId('task-pane');
        await pane.getByTestId('tab-form').click();
        await pane.getByTestId('step-0-edit').click();
        await expect(page.getByTestId('form-editor')).toBeVisible();
      };
      const openPanel = async (key: string): Promise<void> => {
        await press(page.locator(`[data-key="${key}"] .badge.type`));
        await expect(page.getByTestId('field-config')).toBeVisible();
      };

      await openEditor();
      await press(page.getByTestId('tile-smart_dropdown'));
      const created = (await page.getByTestId('field-card').last().getAttribute('data-key')) ?? '';
      expect(created).toMatch(/^neues_feld/);
      await openPanel(created);
      const panel = page.getByTestId('field-config');
      await expect(panel.getByTestId('cfg-smart')).toBeVisible();
      await expect(panel.getByTestId('smart-configure')).toHaveCount(0);

      // Quellfeld: the browse dialog lists the earlier selects of this form
      await press(panel.getByTestId('smart-browse'));
      const picker = page.getByTestId('smart-picker');
      await expect(picker.getByTestId('smart-source-vitalitaet')).toBeVisible();
      await press(picker.getByTestId('smart-source-vitalitaet'));
      await expect(panel.getByTestId('smart-source')).toContainText('Vitalität');

      // the checklist dialog: a tab per source value; a new option is offered for the open tab
      await press(panel.getByTestId('smart-configure'));
      const modal = page.getByTestId('smart-modal');
      await expect(modal.getByTestId('smart-tab-v0')).toBeVisible();
      const input = modal.getByTestId('smart-option-new');
      await input.fill('Eiche');
      await input.press('Enter');
      await input.fill('Buche');
      await input.press('Enter');
      await expect(modal.getByTestId('smart-dot-v0')).toBeVisible();
      await press(modal.getByTestId('smart-tab-v1'));
      await press(modal.getByTestId('smart-option-buche'));
      await expect(modal.getByTestId('smart-dot-v1')).toBeVisible();
      await press(modal.getByTestId('smart-done'));
      await expect(modal).toBeHidden();
      await expect(panel.getByTestId('smart-count')).toHaveText('2');

      // Speichern, reload: the filter is as left
      await expect(page.getByTestId('unsaved')).toBeVisible();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      await openEditor();
      await openPanel(created);
      await expect(page.getByTestId('smart-source')).toContainText('Vitalität');
      await expect(page.getByTestId('smart-count')).toHaveText('2');
    });
  });
}
