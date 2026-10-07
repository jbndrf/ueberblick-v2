import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { publish } from '../support/publish';

/**
 * WP-326: "Unveröffentlichte Änderungen" with one "Veröffentlichen" (Q13/Q16/Q17). A project made from a
 * template is not live (nothing published yet); publishing deploys version 1 and the bar goes; an edit in the
 * builder brings the bar back. Runs at phone and desktop size.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

test.beforeAll(() => {
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
});

/** Signs in as a new admin (`ADMIN_TOTP=off`, the default: e-mail and password only, WP-942). */
async function signIn(page: Page, email: string): Promise<void> {
  expect(admin(['create-admin', email]).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('journey: new project is not published, Veröffentlichen makes version 1, a builder edit brings the bar back', async ({
      page,
    }) => {
      await signIn(page, `bar-${size.name}@example.org`);

      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Bar ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `bar_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));

      // Q17: nothing is live before the first publish.
      const bar = page.getByTestId('publish-bar');
      await expect(bar).toBeVisible();
      await expect(bar).toContainText('Nicht veröffentlicht');
      const status = await page.request.get(`/api/admin/p/${project}/draft/status`);
      expect(await status.json()).toMatchObject({ neverPublished: true, dirty: true, problems: 0 });

      await publish(page, { via: 'bar' });
      expect(await (await page.request.get(`/api/admin/p/${project}/draft/status`)).json()).toMatchObject({
        neverPublished: false,
        dirty: false,
      });

      // Q13: an edit of the draft shows the bar on the pages of the project.
      await page.goto(`/admin/projects/${project}/types/baum/builder`);
      await page.getByTestId('builder-frame').getByRole('button', { name: 'Workflow', exact: true }).click();
      // phone (WP-345): the catalog is a sheet, and the new task opens its pane as a sheet over the toolbar
      if (size.name === 'phone') await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.getByRole('button', { name: 'Schaltfläche', exact: true }).click();
      if (size.name === 'phone') {
        await expect(page.getByTestId('task-pane')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('task-pane')).toBeHidden();
      }
      await page.getByTestId('builder-frame').getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('publish-bar')).toContainText('Unveröffentlichte Änderungen');
      await page.goto(`/admin/projects/${project}/roles`);
      await expect(page.getByTestId('publish-bar')).toContainText('Unveröffentlichte Änderungen');

      await publish(page, { via: 'bar' });
      await page.reload();
      await expect(page.getByTestId('publish-bar')).toBeHidden();
    });
  });
}
