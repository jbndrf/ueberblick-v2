import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { publish } from '../support/publish';

/**
 * WP-418 (S3-19 part a): the header of an Objektart's data page edits in place, as v3's did: click the name to rename
 * it, "Sichtbar für Rollen", the type and geometry pills and "Private Einträge". Each edit is a draft edit (the publish
 * bar), and the sidebar shows the new name after publishing. Runs at phone and desktop size, one project per size.
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

for (const size of SIZES) {
  test.describe(`${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('journey: rename a type in its header, set Private Einträge and the shape, publish; the sidebar shows the new name', async ({
      page,
    }) => {
      await signIn(page, `header-${size.name}@example.org`);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Kopf ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `kopf_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));
      await publish(page, { via: 'bar' });

      await page.goto(`/admin/projects/${project}/types/flaeche`);
      const header = page.getByTestId('data-header');
      await expect(header.getByRole('heading', { level: 1, name: 'Fläche' })).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeHidden();

      // An empty name is refused in place; Escape leaves the name as it was.
      await page.getByTestId('data-name').click();
      await page.getByTestId('data-name-input').fill('');
      await page.getByTestId('data-name-input').press('Enter');
      await expect(page.getByTestId('data-name-error')).toContainText('nicht leer');
      await page.getByTestId('data-name-input').press('Escape');
      await expect(header.getByRole('heading', { level: 1, name: 'Fläche' })).toBeVisible();

      // Rename: one draft edit; the publish bar comes up and the header shows the new name.
      await page.getByTestId('data-name').click();
      await page.getByTestId('data-name-input').fill('Grünfläche');
      await page.getByTestId('data-name-input').press('Enter');
      await expect(header.getByRole('heading', { level: 1, name: 'Grünfläche' })).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toContainText('Unveröffentlichte Änderungen');

      // "Private Einträge" and the shape pills.
      await page.getByTestId('data-private').click();
      await expect(page.getByTestId('data-private')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('data-type-pill')).toContainText('Vorfall');
      await page.getByTestId('data-geometry-pill').click();
      await page.getByTestId('data-geometry-linestring').click();
      await expect(page.getByTestId('data-geometry-pill')).toContainText('Linie');

      // The draft holds it all: reload shows the same, then publish.
      await page.reload();
      await expect(header.getByRole('heading', { level: 1, name: 'Grünfläche' })).toBeVisible();
      await expect(page.getByTestId('data-private')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('data-geometry-pill')).toContainText('Linie');

      await publish(page, { via: 'bar' });
      await page.goto(`/admin/projects/${project}/participants`);
      if (!(await page.getByTestId('group-types').isVisible()))
        await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
      await expect(
        page.getByTestId('group-types').getByRole('link', { name: 'Grünfläche', exact: true }),
      ).toBeVisible();
    });

    test('journey: "Sichtbar für Rollen" adds a role chip, and clearing the roles removes it again', async ({
      page,
    }) => {
      await signIn(page, `roles-${size.name}@example.org`);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Kopfrollen ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `kopfrollen_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));
      await page.goto(`/admin/projects/${project}/types/flaeche`);

      // every role to start with: the "Alle" hint, no chip
      const roles = page.getByTestId('data-roles');
      await expect(roles).toContainText('Alle');
      await expect(roles.locator('[data-slot="badge"]')).toHaveCount(0);

      // pick "Verwaltung" (a dropdown on desktop, a full-screen dialog on a phone) and confirm: one chip, one draft edit
      await page.getByTestId('data-roles').click();
      const trigger = page.getByTestId('data-roles-confirm').locator('xpath=preceding::button[1]');
      await trigger.click();
      await page
        .getByRole('option', { name: 'Verwaltung' })
        .or(page.getByRole('checkbox', { name: 'Verwaltung' }))
        .click();
      const phone = page.getByRole('dialog', { name: 'Optionen auswählen' });
      if (await phone.isVisible()) await phone.getByRole('button', { name: /^Fertig/ }).click();
      else await page.keyboard.press('Escape');
      await page.getByTestId('data-roles-confirm').click();
      await expect(page.getByTestId('data-roles')).toContainText('Verwaltung');
      // a project that was never published: the publish bar says so ("Nicht veröffentlicht", v3's draft status box);
      // "Unveröffentlichte Änderungen" is the title only once a first version is live (WP-482)
      await expect(page.getByTestId('publish-bar')).toContainText('Nicht veröffentlicht');
      await page.reload();
      await expect(page.getByTestId('publish-bar')).toContainText('Nicht veröffentlicht');
      await expect(page.getByTestId('data-roles')).toContainText('Verwaltung');

      // clear it: the chip goes, "Alle" is back
      await page.getByTestId('data-roles').click();
      await trigger.click();
      await page
        .getByRole('option', { name: 'Verwaltung' })
        .or(page.getByRole('checkbox', { name: 'Verwaltung' }))
        .click();
      if (await phone.isVisible()) await phone.getByRole('button', { name: /^Fertig/ }).click();
      else await page.keyboard.press('Escape');
      await page.getByTestId('data-roles-confirm').click();
      await expect(page.getByTestId('data-roles')).toContainText('Alle');
      await expect(page.getByTestId('data-roles').locator('[data-slot="badge"]')).toHaveCount(0);
    });
  });
}
