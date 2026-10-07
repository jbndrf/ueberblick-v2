import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData, goldenFile } from '../golden';

/**
 * WP-444: v3's data tabs in the stage pane ("Tab hinzufügen", rename, "Felder zum aktiven Tab hinzufügen") and the
 * field definition's "In Daten-Tabs ausgeblendet". Both write `display` of the property (WP-659), the same the Felder
 * hub writes. Runs at phone (390x844) and desktop (1280x800) size.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
/** One project per size, so the second run does not start from the first one's saved draft. */
const slugOf = (size: (typeof SIZES)[number]): string => `tab${size.name}`;

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
  expect(admin(['create-admin', 'tabdeploy@example.org']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  for (const size of SIZES) {
    expect(admin(['create-project', slugOf(size), `Tab ${size.name}`]).status).toBe(0);
    expect(admin(['add-membership', 'tabdeploy@example.org', slugOf(size), 'sachbearbeiter']).status).toBe(0);
  }
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'tabdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  for (const size of SIZES) {
    const deploy = await ctx.post(`/api/admin/p/${slugOf(size)}/deploy`, {
      data: goldenData('projects/stadtwerke-meldungen.yaml'),
    });
    expect(await deploy.json()).toMatchObject({ ok: true });
  }
  await ctx.dispose();
});

async function signIn(page: Page, slug: string): Promise<void> {
  const email = `tabs${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, slug, 'sachbearbeiter']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: add a tab, put a field in it, hide another field, save, reopen', async ({ page }) => {
      await signIn(page, slugOf(size));
      await page.goto(`/admin/projects/${slugOf(size)}/types/meldung/builder`);
      const frame = page.getByTestId('builder-frame');
      const pane = page.getByTestId('stage-pane');
      // On a phone the inspector is a sheet over the canvas: the toolbar's "Details" opens it.
      if (size.name === 'phone') await frame.getByTestId('open-inspector').click();
      await expect(pane.getByText('Standardansicht')).toBeVisible();
      await expect(pane.getByRole('tab', { name: 'Daten' })).toHaveAttribute('aria-selected', 'true');

      // "Tab hinzufügen", renamed in place, filled from the library panel.
      await pane.getByRole('button', { name: 'Tab hinzufügen', exact: true }).click();
      await expect(pane.getByRole('tab', { name: 'Neuer Tab' })).toHaveAttribute('aria-selected', 'true');
      await pane.getByRole('button', { name: 'Tab-Name' }).click();
      await pane.getByRole('textbox', { name: 'Tab-Name' }).fill('Fotos');
      await page.keyboard.press('Enter');
      await pane.getByRole('button', { name: 'Felder zum aktiven Tab hinzufügen' }).click();
      await pane.locator('[data-testid="stage-library-item"][data-property="foto"]').click();
      await expect(pane.locator('[data-testid="stage-property"][data-property="foto"]')).toBeVisible();
      await pane.getByRole('button', { name: 'Felder zum aktiven Tab hinzufügen' }).click();

      // The other tab still has the rest; "Beschreibung" is hidden in its field definition.
      await pane.getByRole('tab', { name: 'Daten' }).click();
      await expect(pane.locator('[data-testid="stage-property"][data-property="foto"]')).toHaveCount(0);
      await pane.locator('[data-testid="stage-property"][data-property="beschreibung"]').click();
      const hide = page.getByRole('checkbox', { name: 'In Daten-Tabs ausgeblendet' });
      await expect(hide).not.toBeChecked();
      await hide.check();
      await expect(hide).toBeChecked();

      // Save (on a phone the sheet closes first), then the draft carries both edits and a reload shows them again.
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(frame.getByTestId('unsaved')).toBeHidden();
      const draft = (await (await page.request.get(`/builder-api/${slugOf(size)}/draft`)).json()) as {
        overlay: string;
      };
      expect(draft.overlay).toContain('Fotos');
      expect(draft.overlay).toMatch(/hidden: true/);
      await page.reload();
      if (size.name === 'phone') await frame.getByTestId('open-inspector').click();
      await expect(pane.getByRole('tab', { name: 'Fotos' })).toBeVisible();
      await expect(pane.locator('[data-testid="stage-property"][data-property="beschreibung"]')).toHaveCount(
        0,
      );
      await pane.getByRole('tab', { name: 'Fotos' }).click();
      await expect(pane.locator('[data-testid="stage-property"][data-property="foto"]')).toBeVisible();

      // Deleting the tab asks first and the field is back in "Daten".
      await pane.getByRole('button', { name: 'Tab löschen' }).click();
      await expect(pane.getByTestId('stage-tab-delete-confirm')).toContainText('ohne Tab');
      await pane.getByTestId('stage-tab-delete-yes').click();
      await expect(pane.getByRole('tab', { name: 'Fotos' })).toHaveCount(0);
      await expect(pane.locator('[data-testid="stage-property"][data-property="foto"]')).toBeVisible();
    });
  });
}
