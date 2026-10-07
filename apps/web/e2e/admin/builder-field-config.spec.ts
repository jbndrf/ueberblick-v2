import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-381: v3's FieldConfigPanel for a field selected in the form editor, at desktop (mouse) and phone size (touch,
 * the inspector sheet): Darstellung (placeholder, help text, required, prefill, validation), the Felddefinition one
 * step deeper (number limits, Berechnet with its problem in place), Speichern, reload: the settings are as left.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/cfgstadt/types/baum/builder';

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
  expect(admin(['create-project', 'cfgstadt', 'Config Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'cfgdeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'cfgdeploy@example.org', 'cfgstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'cfgdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/cfgstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `cfg${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'cfgstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, task: 'kontrolle', touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, task: 'befund_ergaenzen', touch: true },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: size.touch });

    test('journey: a new text field gets placeholder, help, required, prefill and a length; the definition shows a problem; Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const press = async (target: Locator): Promise<void> => (size.touch ? target.tap() : target.click());
      const fill = async (target: Locator, text: string): Promise<void> => {
        await target.fill(text);
        await target.press('Tab');
      };
      const openEditor = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator(`[data-path="tasks.${size.task}"]`).click();
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
      await press(page.getByTestId('tile-short_text'));
      const created = (await page.getByTestId('field-card').last().getAttribute('data-key')) ?? '';
      expect(created).toMatch(/^neues_feld/);
      await openPanel(created);
      const panel = page.getByTestId('field-config');
      await expect(panel.getByTestId('cfg-type')).toHaveText('Text');

      // Darstellung: placeholder, help text, required, prefill (constant), min length
      await fill(panel.getByTestId('cfg-placeholder'), 'z. B. Pilzbefall');
      await fill(panel.getByTestId('cfg-help'), 'Was fällt auf?');
      await press(panel.getByTestId('cfg-required'));
      await expect(panel.getByTestId('cfg-required')).toHaveAttribute('aria-checked', 'true');
      await panel.getByTestId('cfg-prefill').selectOption('constant');
      await fill(panel.getByTestId('cfg-prefill-constant'), 'in Ordnung');
      await fill(panel.getByTestId('cfg-min'), '3');
      await expect(page.getByTestId('form-error')).toHaveCount(0);

      // An invalid expression shows its problem in place and is not written
      await panel.getByTestId('cfg-prefill').selectOption('computed');
      await fill(panel.getByTestId('cfg-prefill-expression'), 'self.gibt_es_nicht +');
      await expect(page.getByTestId('form-error')).toBeVisible();
      await panel.getByTestId('cfg-prefill').selectOption('constant');

      // The Felddefinition is one step deeper; "Berechnet" on a field that is in a form says why not
      await press(panel.getByTestId('cfg-edit-definition'));
      const pane = page.getByTestId('field-pane');
      await expect(pane).toBeVisible();
      await press(pane.getByTestId('field-computed'));
      await expect(pane.getByTestId('field-computed-error')).toBeVisible();
      await press(page.getByTestId('form-def-back'));
      await expect(page.getByTestId('field-config')).toBeVisible();
      await press(page.getByTestId('form-field-back'));

      // Speichern, reload: the settings are as left
      await expect(page.getByTestId('unsaved')).toBeVisible();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      await openEditor();
      await openPanel(created);
      await expect(page.getByTestId('cfg-placeholder')).toHaveValue('z. B. Pilzbefall');
      await expect(page.getByTestId('cfg-help')).toHaveValue('Was fällt auf?');
      await expect(page.getByTestId('cfg-required')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('cfg-prefill')).toHaveValue('constant');
      await expect(page.getByTestId('cfg-prefill-constant')).toHaveValue('in Ordnung');
      await expect(page.getByTestId('cfg-min')).toHaveValue('3');
    });

    test('Berechnet: a field that is in no form can become computed from an expression; Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const press = async (target: Locator): Promise<void> => (size.touch ? target.tap() : target.click());
      const fill = async (target: Locator, text: string): Promise<void> => {
        await target.fill(text);
        await target.press('Tab');
      };
      await frame.getByRole('button', { name: 'Modell', exact: true }).click();
      await page.getByTestId('field-hub').getByRole('button', { name: 'Feld hinzufügen' }).click();
      const pane = page.getByTestId('field-pane');
      await expect(pane).toBeVisible();
      await press(pane.getByTestId('field-computed'));
      await fill(pane.getByTestId('field-computed-expression'), 'self.beschreibung');
      await press(pane.getByTestId('field-computed-apply'));
      await expect(pane.getByTestId('field-computed-error')).toHaveCount(0);
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      const draft = (await (await page.request.get('/builder-api/cfgstadt/draft')).json()) as {
        overlay: string;
      };
      expect(draft.overlay).toContain('computed: self.beschreibung');
    });
  });
}
