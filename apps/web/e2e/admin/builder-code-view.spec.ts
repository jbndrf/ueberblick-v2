import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { goldenFile } from '../golden';
import { PASSWORD, admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-379: v3's Code view in the Objektart's builder, at a phone and a desktop size. `?view=code` shows the
 * Objektart as YAML with the provenance margin; a typed task is applied as an overlay op, saved with
 * Speichern, and the Workflow view's canvas and the catalog then show it. A parse error is shown with its
 * line and applies nothing.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'codestadt';
const URL_OF = `/admin/projects/${PROJECT}/types/baum/builder`;

test.use({ locale: 'de-DE' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', PROJECT, 'Code Stadt']).status).toBe(0);
  createAdmin('codedeploy@example.org');
  expect(admin(['add-membership', 'codedeploy@example.org', PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'codedeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `code${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'phone', width: 390, height: 844, key: 'e2e_phone', label: 'Code Phone' },
  { name: 'desktop', width: 1280, height: 800, key: 'e2e_desktop', label: 'Code Desktop' },
] as const;

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: Code view, a parse error, a typed task, Übernehmen, Speichern, the canvas shows it', async ({
      page,
    }, info) => {
      await signIn(page);
      await page.goto(`${URL_OF}?view=code`);
      const frame = page.getByTestId('builder-frame');
      const view = page.getByTestId('code-view');
      await expect(view).toBeVisible();
      await expect(page.locator('.cm-content')).toContainText('types:');
      await expect(view.getByRole('list', { name: 'Herkunft' })).toContainText('Aus der Vorlage');
      await expect(page.locator('[data-provenance]').first()).toBeAttached();
      // no sideways scroll on the page
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`code-${size.name}.png`) });

      // A parse error is explained with its line and applies nothing.
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.insertText('broken: [unclosed\n');
      await expect(page.getByTestId('code-problems')).toContainText(/Zeile \d+/);
      await view.getByTestId('code-apply').click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await view.getByTestId('code-reload').click();
      await expect(page.getByTestId('code-problems')).toHaveCount(0);

      // A task typed at the end of `tasks:` (the last section of the type's code), applied and saved.
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText(
        `\n  ${size.key}:\n    label: { de: ${size.label} }\n    on: baum\n    form:\n      befund: {}\n`,
      );
      await view.getByTestId('code-apply').click();
      await expect(page.getByTestId('code-message')).toContainText('Übernommen');
      await expect(page.getByTestId('unsaved')).toBeVisible();
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();

      // The Workflow view's canvas shows the new task.
      await frame.getByRole('button', { name: 'Workflow', exact: true }).click();
      await expect(page).toHaveURL(/[?&]view=workflow/);
      await expect(page.getByTestId('builder-canvas')).toContainText(size.label);

      // It stayed after a reload.
      await page.reload();
      await expect(page.getByTestId('builder-canvas')).toContainText(size.label);
    });
  });
}
