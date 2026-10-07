import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-464: hide a template task in the builder (task pane, "Ausblenden"), find it greyed in the catalog with the
 * "Einblenden" pill (WP-452, A-050), unhide it and see the row back. Phone (390x844) and desktop (1280x800).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/unhidestadt/types/baum/builder';

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
  expect(admin(['create-project', 'unhidestadt', 'Prov Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'unhidedeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'unhidedeploy@example.org', 'unhidestadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'unhidedeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/unhidestadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `unhide${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'unhidestadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: size.name === 'phone' });

    test('journey: hide a template task, find it in the catalog with Einblenden, unhide it', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const openCatalog = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      };
      await openCatalog();
      const path = 'tasks.befund_ergaenzen';
      const visibleRow = page.locator(`[data-path="${path}"]:not([data-hidden])`);
      await visibleRow.click();
      const pane = page.getByTestId('task-pane');
      await expect(pane.getByTestId('task-delete')).toHaveText(/Ausblenden/);
      await pane.getByTestId('task-delete').click();
      await page.getByTestId('confirm-delete-action').click();

      // Gone from the visible list; greyed at the end with the pill.
      await openCatalog();
      const hidden = page.locator(`[data-path="${path}"][data-hidden="true"]`);
      await expect(hidden).toBeVisible();
      await expect(visibleRow).toHaveCount(0);
      await hidden.getByRole('button', { name: 'Einblenden' }).click();
      await expect(hidden).toHaveCount(0);
      await expect(visibleRow).toBeVisible();
    });

    // WP-489 (464): a hidden rule row and a hidden field row come back with their Einblenden pill too.
    test('journey: hide a template rule and a template field, unhide both from the catalog', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const openCatalog = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      };
      await openCatalog();
      const rulePath = 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden';
      const ruleRow = page.locator(`[data-path="${rulePath}"]:not([data-hidden])`);
      await ruleRow.click();
      const rulePane = page.getByTestId('rule-pane');
      await expect(rulePane.getByTestId('rule-delete')).toHaveText(/Ausblenden/);
      await rulePane.getByTestId('rule-delete').click();
      await page.getByTestId('confirm-delete-action').click();
      await openCatalog();
      const hiddenRule = page.locator(`[data-path="${rulePath}"][data-hidden="true"]`);
      await expect(hiddenRule).toBeVisible();
      await expect(ruleRow).toHaveCount(0);
      await hiddenRule.getByRole('button', { name: 'Einblenden' }).click();
      await expect(hiddenRule).toHaveCount(0);
      await expect(ruleRow).toBeVisible();

      // A field: hide it from its card's menu in the Kontrolle form.
      await page.locator('[data-path="tasks.kontrolle"]:not([data-hidden])').click();
      const pane = page.getByTestId('task-pane');
      await pane.getByTestId('tab-form').click();
      await pane.getByTestId('step-0-edit').click();
      const card = page.locator('[data-key="hoehe_klasse"]');
      if (size.name === 'desktop') await card.hover();
      await card.getByTestId('field-menu').click();
      await page.getByTestId('menu-delete').click();
      // WP-490: a template field is hidden, so the dialog says "ausblenden" and the button "Ausblenden".
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText('ausblenden?');
      await expect(dialog.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Ausblenden' }).click();
      if (size.name === 'phone') {
        await page.getByTestId('form-close').click();
        await page.keyboard.press('Escape');
      }
      await openCatalog();
      const fieldPath = 'types.baum.properties.hoehe_klasse';
      const hiddenField = page.locator(`[data-path="${fieldPath}"][data-hidden="true"]`);
      await expect(hiddenField).toBeVisible();
      await hiddenField.getByRole('button', { name: 'Einblenden' }).click();
      await expect(hiddenField).toHaveCount(0);
      await expect(page.locator(`[data-path="${fieldPath}"]:not([data-hidden])`)).toBeVisible();
    });
  });
}
