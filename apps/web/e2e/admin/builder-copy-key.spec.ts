import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-489 (451): the builder's key copy buttons, which all use the shared clipboard helper (`copyText`): the task
 * pane, the rule pane, the field pane and a form card's menu. Each puts the key on the clipboard. Phone (390x844) and
 * desktop (1280x800).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/kopierstadt/types/baum/builder';

test.use({ locale: 'de-DE', permissions: ['clipboard-read', 'clipboard-write'] });

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
  expect(admin(['create-project', 'kopierstadt', 'Kopier Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'kopierdeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'kopierdeploy@example.org', 'kopierstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'kopierdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/kopierstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `kopier${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'kopierstadt', 'verwaltung']).status).toBe(0);
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

const clipboard = (page: Page): Promise<string> => page.evaluate(() => navigator.clipboard.readText());

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: size.name === 'phone' });

    test('journey: the task, rule, field and card-menu copy buttons put the key on the clipboard', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const openCatalog = async (): Promise<void> => {
        if (size.name !== 'phone') return;
        // Phone: the pane of the last selection is a sheet over the frame; close it to reach the catalog button.
        await page.keyboard.press('Escape');
        await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      };
      await openCatalog();

      await page.locator('[data-path="tasks.befund_ergaenzen"]').click();
      const taskPane = page.getByTestId('task-pane');
      await taskPane.getByTestId('task-copy-key').click();
      await expect(taskPane.getByTestId('task-copy-key')).toContainText('Schlüssel kopiert');
      expect(await clipboard(page)).toBe('befund_ergaenzen');

      await openCatalog();
      await page.locator('[data-path="tasks.massnahme_anlegen.auto.massnahme_bei_schaden"]').click();
      const rulePane = page.getByTestId('rule-pane');
      await rulePane.getByTestId('rule-copy-key').click();
      await expect(rulePane.getByTestId('rule-copy-key')).toContainText('Schlüssel kopiert');
      expect(await clipboard(page)).toBe('massnahme_anlegen.massnahme_bei_schaden');

      await openCatalog();
      await page.locator('[data-path="types.baum.properties.vitalitaet"]').click();
      const fieldPane = page.getByTestId('field-pane');
      await fieldPane.getByRole('button', { name: 'Schlüssel kopieren' }).click();
      expect(await clipboard(page)).toBe('vitalitaet');

      await openCatalog();
      await page.locator('[data-path="tasks.befund_ergaenzen"]').click();
      await page.getByTestId('task-pane').getByTestId('tab-form').click();
      await page.getByTestId('task-pane').getByTestId('step-0-edit').click();
      const card = page.locator('[data-key="befund"]');
      if (size.name === 'desktop') await card.hover();
      await card.getByTestId('field-menu').click();
      await page.getByTestId('menu-copy-key').click();
      expect(await clipboard(page)).toBe('befund');
    });
  });
}
