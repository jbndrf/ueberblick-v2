import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { goldenFile } from '../golden';
import { PASSWORD, admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-440: the Code view's second tab "Anpassungen" (the overlay of this Objektart) after a rename, and
 * "Formular kopieren" in the task pane's YAML tab, at a phone and a desktop size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'anpassstadt';
const URL_OF = `/admin/projects/${PROJECT}/types/baum/builder`;

test.use({ locale: 'de-DE' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', PROJECT, 'Anpass Stadt']).status).toBe(0);
  createAdmin('anpassdeploy@example.org');
  expect(admin(['add-membership', 'anpassdeploy@example.org', PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'anpassdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `anpass${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: rename a task, see it in Anpassungen, copy its form', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const pickTask = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator('[data-path="tasks.kontrolle"]').click();
      };

      // Rename the task in the pane.
      await pickTask();
      const pane = page.getByTestId('task-pane');
      await pane.getByTestId('task-label').fill(`Prüfrunde ${size.name}`);
      await pane.getByTestId('task-label').blur();
      await expect(page.getByTestId('unsaved')).toBeVisible();

      // Formular kopieren in the YAML tab: the form YAML on the clipboard, a toast says so.
      await pane.getByTestId('tab-yaml').click();
      await pane.getByTestId('form-copy').click();
      await expect(page.getByText('Formular kopiert')).toBeVisible();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toMatch(/^form:/);
      expect(copied).not.toContain('label: { de: Prüfrunde');

      // phone: the pane is a sheet; close it before the toolbar is reachable
      if (size.name === 'phone') await page.keyboard.press('Escape');

      // The Code view: Anpassungen shows the rename; the effective text has no such tab content.
      await frame.getByRole('button', { name: 'Code', exact: true }).click();
      await expect(page).toHaveURL(/[?&]view=code/);
      await expect(page.getByTestId('code-copy')).toHaveText(/Kopieren/);
      await page.getByRole('tab', { name: 'Anpassungen' }).click();
      const text = page.getByTestId('overlay-text');
      await expect(text).toHaveValue(/tasks\.kontrolle\.label/);
      await expect(text).toHaveValue(new RegExp(`Prüfrunde ${size.name}`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole('tab', { name: 'Code' }).click();
      await expect(page.getByTestId('code-view')).toBeVisible();
    });
  });
}
