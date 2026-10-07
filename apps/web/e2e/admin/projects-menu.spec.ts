import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { scan } from '../../../../e2e/a11y/axe';
import { publish } from '../support/publish';
import { goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-383 (S3-7): the ⋮ menu of a project card and the split button on the Projekte page: "Schema exportieren",
 * "Als Vorlage veröffentlichen" and "Aus Datei importieren" (with problems). Runs at phone and desktop size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, project: 'Menue Phone', key: 'menue_phone' },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, project: 'Menue Desktop', key: 'menue_desktop' },
] as const;

test.use({ bypassCSP: true, locale: 'de-DE' });

test.beforeAll(() => {
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
});

async function createPublishedProject(page: Page, name: string): Promise<void> {
  await page.goto('/admin/projects/new');
  await page.getByLabel('Projektname').fill(name);
  await page.getByLabel('Vorlage').selectOption('baumkataster@1');
  await page.getByRole('button', { name: 'Projekt erstellen' }).click();
  await expect(page).toHaveURL(/\/participants$/);
  await publish(page, { via: 'bar' });
  await page.goto('/admin/projects');
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('journey: publish as template, offered by Projekt erstellen, export the schema, import it, refuse a bad file', async ({
      page,
    }) => {
      const email = `menue-${size.name}@example.org`;
      createAdmin(email);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects$/);
      await createPublishedProject(page, size.project);
      const card = page.locator('[data-slot="card"]').filter({ hasText: size.project });
      const openMenu = () => card.getByRole('button', { name: `Aktionen für ${size.project}` }).click();
      expect(await scan(page)).toEqual([]);

      // Als Vorlage veröffentlichen: the dialog starts with the project's key, name and version 1.0.0
      await openMenu();
      await expect(page.getByRole('menuitem')).toHaveText([
        'Schema exportieren',
        'Gesamtes Projekt exportieren (ZIP)',
        'Daten exportieren (CSV)',
        'GeoPackage exportieren',
        'Als Vorlage veröffentlichen',
      ]);
      await page.getByRole('menuitem', { name: 'Als Vorlage veröffentlichen' }).click();
      const dialog = page.getByRole('dialog', { name: 'Als Vorlage veröffentlichen' });
      await expect(dialog.getByLabel('Schlüssel')).toHaveValue(size.key);
      await expect(dialog.getByLabel('Version')).toHaveValue('1.0.0');
      await dialog.getByLabel('Version').fill('x');
      await dialog.getByRole('button', { name: 'Veröffentlichen' }).click();
      await expect(dialog.getByText('Eine Version hat die Form 1.0.0.')).toBeVisible();
      await dialog.getByLabel('Version').fill('1.0.0');
      await dialog.getByRole('button', { name: 'Veröffentlichen' }).click();
      await expect(page.getByText(`Vorlage ${size.key} 1.0.0 veröffentlicht`)).toBeVisible();

      // ... and "Projekt erstellen" now offers it
      await page.goto('/admin/projects/new');
      await expect(page.getByLabel('Vorlage').locator('option', { hasText: size.project })).toHaveCount(1);
      await page.goto('/admin/projects');

      // Schema exportieren: a YAML download of the effective file
      await openMenu();
      const download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Schema exportieren' }).click();
      const file = await download;
      await expect(page.getByText('Projektschema exportiert')).toBeVisible();
      expect(file.suggestedFilename()).toBe(`${size.project.toLowerCase().replace(/\s+/g, '-')}-schema.yaml`);
      const path = join(tmpdir(), `${size.key}-schema.yaml`);
      await file.saveAs(path);
      const exported = parse(readFileSync(path, 'utf8')) as { schema: string; template: { key: string } };
      expect(exported.schema).toBe('ueberblick/1');
      expect(exported.template.key).toBe('baumkataster');

      // Aus Datei importieren: the exported file makes a new project
      await page.getByRole('button', { name: 'Weitere Optionen zum Erstellen' }).click();
      await expect(page.getByRole('menuitem', { name: 'Aus Datei importieren' })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByTestId('import-file').setInputFiles(path);
      await expect(page.getByText('Projekt erfolgreich importiert')).toBeVisible();
      await expect(page.locator('[data-slot="card"]')).toHaveCount(2);

      // an invalid file: the problems are listed, nothing is created
      const bad = join(tmpdir(), `${size.key}-bad.yaml`);
      writeFileSync(bad, 'schema: ueberblick/1\nextends: gibtsnicht@1\n');
      await page.getByTestId('import-file').setInputFiles(bad);
      const problems = page.getByRole('dialog', { name: 'Die Datei kann nicht importiert werden' });
      await expect(problems.getByText('extends', { exact: true })).toBeVisible();
      expect(await scan(page)).toEqual([]);
      await problems.getByRole('button', { name: 'Schließen' }).first().click();
      await expect(page.locator('[data-slot="card"]')).toHaveCount(2);
    });
  });
}
