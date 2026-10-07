import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-439: v3's "Regex Pattern" (text) and "Step" (number) in the field panel's validation, at desktop (mouse) and
 * phone size (touch, the inspector sheet): a pattern outside the `matches` subset shows its problem and is not written;
 * a pattern on a text field and a step on a whole-number field, Speichern, reload: the values are as left.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/valstadt/types/baum/builder';

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
  expect(admin(['create-project', 'valstadt', 'Config Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'valdeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'valdeploy@example.org', 'valstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'valdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/valstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `val${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'valstadt', 'verwaltung']).status).toBe(0);
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

    test('journey: a pattern on a text and a step on a whole number, an invalid pattern shows its problem; Speichern, reload', async ({
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
      const addField = async (tile: string): Promise<string> => {
        await press(page.getByTestId(`tile-${tile}`));
        const key = (await page.getByTestId('field-card').last().getAttribute('data-key')) ?? '';
        expect(key).toMatch(/^neues_feld/);
        return key;
      };

      await openEditor();
      const text = await addField('short_text');
      await openPanel(text);
      const panel = page.getByTestId('field-config');

      // A pattern outside the subset shows the problem under the input and is not written
      await fill(panel.getByTestId('cfg-pattern'), '(?=a)b');
      await expect(panel.getByTestId('cfg-pattern-error')).toBeVisible();
      await fill(panel.getByTestId('cfg-pattern'), '^[A-Z]{2}-[0-9]+$');
      await expect(panel.getByTestId('cfg-pattern-error')).toHaveCount(0);
      await press(page.getByTestId('form-field-back'));

      // A decimal number has a step too (WP-457): 0.5 is written exactly; 0 shows the problem
      const number = await addField('number');
      await openPanel(number);
      await fill(page.getByTestId('cfg-step'), '0');
      await expect(page.getByTestId('cfg-step-error')).toBeVisible();
      await fill(page.getByTestId('cfg-step'), '0.5');
      await expect(page.getByTestId('cfg-step-error')).toHaveCount(0);
      await expect(page.getByTestId('form-error')).toHaveCount(0);
      await press(page.getByTestId('form-field-back'));

      // Speichern, reload: the values are as left
      await expect(page.getByTestId('unsaved')).toBeVisible();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      await openEditor();
      await openPanel(text);
      await expect(page.getByTestId('cfg-pattern')).toHaveValue('^[A-Z]{2}-[0-9]+$');
      await press(page.getByTestId('form-field-back'));
      await openPanel(number);
      await expect(page.getByTestId('cfg-step')).toHaveValue('0.5');
    });
  });
}
