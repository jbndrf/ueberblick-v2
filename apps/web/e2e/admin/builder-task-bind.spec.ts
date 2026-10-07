import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { publish } from '../support/publish';

/**
 * WP-462: the task bind editor "Verknüpfte Objekte" (WP-458, A-053) in the real task pane at desktop and phone size:
 * add a bind from the Objektart's one-relations, use it for a linked field, rename and remove are refused with the
 * fields named, Speichern, reload.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/bindstadt/types/baum/builder';

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
  expect(admin(['create-project', 'bindstadt', 'Bind Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'binddeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'binddeploy@example.org', 'bindstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'binddeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/bindstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `bind${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'bindstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, task: 'befund_ergaenzen' },
  { name: 'phone', viewport: { width: 390, height: 844 }, task: 'verschieben' },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: size.name === 'phone' });

    test('journey: add a bind, use it in the form, rename and remove are refused, Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const open = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator(`[data-path="tasks.${size.task}"]`).click();
        await expect(page.getByTestId('task-pane')).toBeVisible();
      };
      await open();
      const pane = page.getByTestId('task-pane');
      const binds = pane.getByTestId('task-binds');
      await expect(binds).toBeVisible();
      await expect(binds.getByTestId('task-bind-row')).toHaveCount(0);

      // Add: the relation select offers the Objektart's one-relations (Fläche), the row appears
      await binds.getByTestId('task-bind-add').selectOption('flaeche');
      const row = binds.locator('[data-bind="flaeche"]');
      await expect(row).toHaveCount(1);
      await expect(row.getByTestId('task-bind-relation')).toContainText('Fläche');
      await expect(binds.getByTestId('task-bind-error')).toHaveCount(0);
      await expect(page.getByTestId('unsaved')).toBeVisible();

      // Use it: a linked field in the form
      await pane.getByTestId('tab-form').click();
      await pane.getByTestId('step-0-edit').click();
      await page.getByTestId('linked-add').click();
      await page.getByTestId('linked-bind-flaeche').click();
      await page.getByTestId('linked-field-name').click();
      await expect(page.locator('[data-key="flaeche.name"]')).toHaveCount(1);
      await page.getByTestId('form-close').click();
      await expect(page.getByTestId('form-editor')).toHaveCount(0);
      if (size.name === 'phone') {
        await page.keyboard.press('Escape');
        await open();
      }
      await pane.getByTestId('tab-definition').click();

      // Remove and rename are refused: the error names the field, the bind stays
      await binds.getByTestId('task-bind-remove').click();
      await expect(page.getByTestId('bind-impact-fields')).toContainText('flaeche.name');
      await page.getByTestId('bind-impact-close').click();
      await expect(page.getByTestId('bind-impact')).toHaveCount(0);
      await expect(binds.getByTestId('task-bind-row')).toHaveCount(1);
      const name = binds.getByTestId('task-bind-name');
      await name.fill('gebiet');
      await name.blur();
      await expect(page.getByTestId('bind-impact-fields')).toContainText('flaeche.name');
      await page.getByTestId('bind-impact-close').click();
      await expect(page.getByTestId('bind-impact')).toHaveCount(0);
      // WP-490: the refused name does not stay in the input.
      await expect(name).toHaveValue('flaeche');
      await expect(binds.locator('[data-bind="flaeche"]')).toHaveCount(1);

      // Speichern, reload: the bind stayed
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      await open();
      await expect(page.getByTestId('task-binds').locator('[data-bind="flaeche"]')).toHaveCount(1);

      // WP-489 (462): the draft with the bind and its linked field publishes; the publish bar goes.
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await publish(page, { via: 'bar' });
    });
  });
}
