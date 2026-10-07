import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-471 (A-054): "Nur wenn inaktiv ≥ Tage" on a Zeitplan trigger, at desktop and phone size: set 14, Speichern,
 * reload, the value is kept; clearing the field removes it.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/leerlaufstadt/types/baum/builder';

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
  expect(admin(['create-project', 'leerlaufstadt', 'Regel Stadt']).status).toBe(0);
  createAdmin('idledeploy@example.org');
  expect(admin(['add-membership', 'idledeploy@example.org', 'leerlaufstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'idledeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/leerlaufstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `idle${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'leerlaufstadt', 'verwaltung']).status).toBe(0);
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
    test.use({ viewport: size.viewport });
    const phone = size.name === 'phone';

    test('set the idle days on a scheduled rule, Speichern, reload, then clear it', async ({ page }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      if (phone) await frame.getByTestId('open-catalog').click();
      await page.getByRole('button', { name: 'Automatisch', exact: true }).click();
      const pane = page.getByTestId('rule-pane');
      const key = (await pane.getAttribute('data-rule')) ?? '';
      await pane.getByTestId('rule-trigger-kind').selectOption('schedule');
      await pane.getByTestId('rule-trigger-cron').fill('0 2 * * *');
      await pane.getByTestId('rule-trigger-idle').fill('14');
      await pane.getByTestId('rule-trigger-idle').blur();
      await expect(pane.getByTestId('rule-error')).toHaveCount(0);

      if (phone) await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      if (phone) await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${key.replace('.', '.auto.')}"]`).click();
      await expect(page.getByTestId('rule-trigger-idle')).toHaveValue('14');

      await page.getByTestId('rule-trigger-idle').fill('');
      await page.getByTestId('rule-trigger-idle').blur();
      if (phone) await page.keyboard.press('Escape');
      await page.getByTestId('builder-frame').getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      if (phone) await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${key.replace('.', '.auto.')}"]`).click();
      await expect(page.getByTestId('rule-trigger-idle')).toHaveValue('');
    });
  });
}
