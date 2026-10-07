import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { goldenFile } from '../golden';
import { PASSWORD, admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-437: the builder toolbar's gear (v3 `builder/+page.svelte:278-285`): the Objektart's own settings in the right pane
 * ("Objektart-Einstellungen", v3 "Workflow-Einstellungen"). Runs at phone (390x844, the pane is a sheet) and desktop
 * (1280x800, the pane is the right sidebar) size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const BUILDER = '/admin/projects/toolbarstadt/types/baum/builder';
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'toolbarstadt', 'Toolbar Stadt']).status).toBe(0);
  createAdmin('toolbardeploy@example.org');
  expect(admin(['add-membership', 'toolbardeploy@example.org', 'toolbarstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect(
    (
      await ctx.post('/api/auth/login', { data: { email: 'toolbardeploy@example.org', password: PASSWORD } })
    ).status(),
  ).toBe(200);
  const deploy = await ctx.post('/api/admin/p/toolbarstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `toolbar${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'toolbarstadt', 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the gear opens the Objektart settings; renaming there shows in the toolbar; the entry for icons is a link', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(BUILDER);
      const frame = page.getByTestId('builder-frame');
      await expect(frame.getByTestId('type-name')).toHaveValue('Baum');

      await frame.getByRole('button', { name: 'Objektart-Einstellungen' }).click();
      const pane = page.getByTestId('type-settings-pane');
      await expect(pane).toBeVisible();
      await expect(pane.getByRole('heading', { name: 'Objektart-Einstellungen' })).toBeVisible();
      await expect(pane.getByRole('checkbox', { name: 'Private Einträge' })).toBeVisible();
      await expect(pane.getByRole('link', { name: /Standardfilter & Karten-Symbole/ })).toHaveAttribute(
        'href',
        '/admin/projects/toolbarstadt/types/baum',
      );

      const name = pane.getByTestId('type-settings-name');
      await name.fill('Straßenbaum');
      await name.press('Tab');
      await expect(frame.getByTestId('type-name')).toHaveValue('Straßenbaum');
      await expect(frame.getByTestId('unsaved')).toBeVisible();

      // a private switch is the matrix's op, one click each way
      const priv = pane.getByRole('checkbox', { name: 'Private Einträge' });
      await priv.click();
      await expect(priv).toBeChecked();
      await priv.click();
      await expect(priv).not.toBeChecked();
    });

    test('renaming in the toolbar input itself marks the draft and shows in the settings', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(BUILDER);
      const frame = page.getByTestId('builder-frame');
      const input = frame.getByTestId('type-name');
      await expect(input).toHaveValue('Baum');
      await input.fill('Alleebaum');
      await input.press('Tab');
      await expect(input).toHaveValue('Alleebaum');
      await expect(frame.getByTestId('unsaved')).toBeVisible();
      await frame.getByRole('button', { name: 'Objektart-Einstellungen' }).click();
      await expect(page.getByTestId('type-settings-name')).toHaveValue('Alleebaum');
    });
  });
}
