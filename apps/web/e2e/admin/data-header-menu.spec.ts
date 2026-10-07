import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { publish } from '../support/publish';

/**
 * WP-419 (S3-19 part b): the ⋮ menu of an Objektart's data page, as v3's: "Duplizieren" copies the design under a new
 * name and opens the copy, "Aus Projekt importieren" copies one from another project, "Objektart löschen" asks with the
 * counts and removes the type. All three are draft edits that "Veröffentlichen" carries out. Phone and desktop size,
 * one pair of projects per size.
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

async function signIn(page: Page, email: string): Promise<void> {
  expect(admin(['create-admin', email]).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

async function newProject(page: Page, name: string, key: string): Promise<void> {
  await page.goto('/admin/projects/new');
  await page.getByLabel('Projektname').fill(name);
  await page.getByLabel('Vorlage').selectOption('baumkataster@1');
  await page.getByRole('button', { name: 'Projekt erstellen' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/projects/${key}/participants$`));
  await publish(page, { via: 'bar' });
}

async function sidebarTypes(page: Page, project: string) {
  await page.goto(`/admin/projects/${project}/participants`);
  if (!(await page.getByTestId('group-types').isVisible()))
    await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
  return page.getByTestId('group-types');
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('journey: duplicate a type, publish, the sidebar lists the copy; delete it, publish, it is gone; import from another project', async ({
      page,
    }) => {
      await signIn(page, `menu-${size.name}@example.org`);
      const quelle = `quelle_${size.name}`;
      const ziel = `ziel_${size.name}`;
      await newProject(page, `Quelle ${size.name}`, quelle);
      await newProject(page, `Ziel ${size.name}`, ziel);

      // Duplizieren: the copy is in the draft and the page opens it.
      await page.goto(`/admin/projects/${ziel}/types/flaeche`);
      await page.getByTestId('data-menu').click();
      await page.getByTestId('data-menu-duplicate').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${ziel}/types/flaeche_kopie$`));
      await expect(
        page.getByTestId('data-header').getByRole('heading', { level: 1, name: 'Fläche (Kopie)' }),
      ).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toContainText('Unveröffentlichte Änderungen');
      await publish(page, { via: 'bar' });
      await expect(
        (await sidebarTypes(page, ziel)).getByRole('link', { name: 'Fläche (Kopie)', exact: true }),
      ).toBeVisible();

      // Objektart löschen: the dialog counts what goes with it; no Objekte, so nothing to type.
      await page.goto(`/admin/projects/${ziel}/types/flaeche_kopie`);
      await page.getByTestId('data-menu').click();
      await page.getByTestId('data-menu-delete').click();
      const dialog = page.getByTestId('delete-type-dialog');
      await expect(dialog).toContainText('Veröffentlichen');
      await expect(page.getByTestId('delete-type-confirm')).toHaveCount(0);
      await page.getByTestId('delete-type-submit').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${ziel}/settings`));
      await expect(page.getByTestId('publish-bar')).toContainText('Unveröffentlichte Änderungen');
      // With no Objekte nothing is left to discard; the overview just publishes.
      await publish(page, { via: 'bar' });
      await expect(
        (await sidebarTypes(page, ziel)).getByRole('link', { name: 'Fläche (Kopie)', exact: true }),
      ).toHaveCount(0);

      // Aus Projekt importieren: pick the other project and one of its types; the page opens the copy.
      await page.goto(`/admin/projects/${ziel}/types/flaeche`);
      await page.getByTestId('data-menu').click();
      await page.getByTestId('data-menu-import').click();
      const importDialog = page.getByTestId('import-type-dialog');
      await expect(importDialog).toContainText('Rollenberechtigungen');
      await importDialog.getByLabel('Projekt').selectOption(quelle);
      await importDialog.getByLabel('Objektart').selectOption('flaeche');
      await page.getByTestId('import-type-submit').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${ziel}/types/flaeche_kopie$`));
      await expect(page.getByTestId('publish-bar')).toContainText('Unveröffentlichte Änderungen');
    });
  });
}
