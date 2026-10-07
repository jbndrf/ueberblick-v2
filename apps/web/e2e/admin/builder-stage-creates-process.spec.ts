import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-508: "Phase hinzufügen" on an Objektart without a process creates the process (the stage property, a start
 * and an end stage) as one change; Speichern and a reload show it. Phone (390x844) and desktop (1280x800).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
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

async function signIn(page: Page, email: string): Promise<void> {
  expect(admin(['create-admin', email]).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: new Objektart, Phase hinzufügen, Speichern, reload shows the stage', async ({ page }) => {
      await signIn(page, `stageproc-${size.name}@example.org`);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Phasen ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `phasen_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));

      if (!(await page.getByTestId('group-types').isVisible())) {
        await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
      }
      await page.getByTestId('group-types').getByRole('button', { name: 'Objektart hinzufügen' }).click();
      await page.getByRole('menuitem', { name: 'Neue Objektart' }).click();
      await page.getByTestId('new-type-name').fill('Spielplatz');
      await page.getByTestId('new-type-create').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/types/spielplatz/builder$`));

      const frame = page.getByTestId('builder-frame');
      if (size.name === 'phone') {
        // the sidebar sheet is still open from the type menu
        if (await page.getByTestId('group-types').isVisible()) await page.keyboard.press('Escape');
        await frame.getByTestId('open-catalog').click();
      }
      await page.getByRole('button', { name: 'Phase', exact: true }).click();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await expect(frame.getByTestId('unsaved')).toBeVisible();
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(frame.getByTestId('unsaved')).toBeHidden();

      await page.reload();
      await expect(page.getByText('Neue Phase').first()).toBeVisible();
    });
  });
}
