import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-445: the provenance mark (Vorlage / Geändert / Hinzugefügt) on a form field card, with "Auf Vorlage
 * zurücksetzen" in its "⋯" menu, on a template project at phone and desktop size: change a field's label, see
 * "Geändert", reset, see "Vorlage" again with the template's label back.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/provstadt/types/baum/builder';

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
  expect(admin(['create-project', 'provstadt', 'Prov Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'provdeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'provdeploy@example.org', 'provstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'provdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/provstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `prov${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'provstadt', 'verwaltung']).status).toBe(0);
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

    test('journey: change a field label, see Geändert, reset, see Vorlage', async ({ page }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const press = async (target: Locator): Promise<void> => (size.touch ? target.tap() : target.click());
      if (size.name === 'phone') await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.locator('[data-path="tasks.befund_ergaenzen"]').click();
      const pane = page.getByTestId('task-pane');
      // The task pane carries the mark too
      await expect(pane.getByTestId('provenance-mark')).toHaveAttribute('data-provenance', 'template');
      await pane.getByTestId('tab-form').click();
      await pane.getByTestId('step-0-edit').click();
      await expect(page.getByTestId('form-editor')).toBeVisible();

      const card = page.locator('[data-key="befund"]');
      const mark = card.getByTestId('provenance-mark');
      await expect(mark).toHaveAttribute('data-provenance', 'template');
      await expect(mark).toHaveText('Vorlage');
      const label = (await card.getByTestId('card-label').textContent())?.trim() ?? '';

      await press(card.getByTestId('card-label'));
      await page.getByTestId('card-label-input').fill('Zustand des Baums');
      await page.getByTestId('card-label-input').press('Enter');
      await expect(mark).toHaveAttribute('data-provenance', 'changed');
      await expect(mark).toHaveText('Geändert');

      if (!size.touch) await card.hover();
      await press(card.getByTestId('field-menu'));
      await press(page.getByTestId('menu-reset'));
      await expect(mark).toHaveAttribute('data-provenance', 'template');
      await expect(mark).toHaveText('Vorlage');
      expect((await card.getByTestId('card-label').textContent())?.trim()).toBe(label);
      await expect(page.getByTestId('form-error')).toHaveCount(0);
    });

    // WP-454: the marks on the canvas, and the reset in the right-click menu of a changed task row.
    test('journey: the canvas marks a task row and a stage node, and resets a changed task from its menu', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      const row = canvas.locator('[data-task-id="kontrolle"]').first();
      const mark = row.getByTestId('provenance-mark');
      await expect(canvas.locator('[data-stage-node] [data-testid="provenance-mark"]').first()).toBeVisible();
      await expect(mark).toHaveAttribute('data-provenance', 'changed');
      await row.dispatchEvent('contextmenu');
      await page.getByRole('menuitem', { name: 'Auf Vorlage zurücksetzen' }).click();
      await expect(mark).toHaveAttribute('data-provenance', 'template');
      await row.dispatchEvent('contextmenu');
      await expect(page.getByRole('menuitem', { name: 'Ausblenden' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Auf Vorlage zurücksetzen' })).toHaveCount(0);
    });

    // WP-480: the stage pane carries the mark of its own (the golden template locks its stages: the lock shows).
    test('journey: the stage pane shows the provenance mark and a locked stage cannot be hidden', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      await canvas.locator('[data-stage-node="kontrolliert"]').dispatchEvent('click');
      const pane = page.getByTestId('stage-pane');
      await expect(pane.getByTestId('provenance-mark')).toHaveAttribute('data-provenance', 'template');
      await expect(pane.getByTestId('provenance-lock')).toBeVisible();
      await expect(pane.getByTestId('stage-delete')).toBeDisabled();
    });
  });
}
