import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { scan } from '../../../../e2e/a11y/axe';
import { goldenFile } from '../golden';
import { publish } from '../support/publish';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-384 (S3-8): the Projekte page's ⋮ menu exports (ZIP, CSV, GeoPackage) and "Gesamtes Projekt importieren (ZIP)",
 * with the dialog's phases. Runs at phone and desktop size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, project: 'Export Phone' },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, project: 'Export Desktop' },
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

    test('journey: export the ZIP, the CSV and the GeoPackage, then import the ZIP as a new project', async ({
      page,
    }) => {
      const email = `export-${size.name}@example.org`;
      createAdmin(email);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects$/);
      await createPublishedProject(page, size.project);
      const card = page.locator('[data-slot="card"]').filter({ hasText: size.project });
      const openMenu = () => card.getByRole('button', { name: `Aktionen für ${size.project}` }).click();
      expect(await scan(page)).toEqual([]);

      // Gesamtes Projekt exportieren (ZIP): a ZIP with the manifest and the project file
      await openMenu();
      let download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Gesamtes Projekt exportieren (ZIP)' }).click();
      const zip = await download;
      await expect(page.getByText('Projektarchiv exportiert')).toBeVisible();
      // the file holds the participants' login tokens (A-046): the toast says it stays confidential
      await expect(
        page.getByText('Enthält die Zugangsdaten der Teilnehmenden, vertraulich aufbewahren.'),
      ).toBeVisible();
      expect(zip.suggestedFilename()).toBe(`${size.project.toLowerCase().replace(/\s+/g, '-')}.zip`);
      const zipPath = join(tmpdir(), `export-${size.name}.zip`);
      await zip.saveAs(zipPath);
      const bytes = readFileSync(zipPath);
      expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
      expect(bytes.includes('manifest.json')).toBe(true);
      expect(bytes.includes('project.yaml')).toBe(true);
      expect(bytes.includes('roster/participants.ndjson')).toBe(true);

      // Daten exportieren (CSV): a ZIP with a CSV per Objektart
      await openMenu();
      download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Daten exportieren (CSV)' }).click();
      const csv = await download;
      await expect(page.getByText('CSV-Daten exportiert')).toBeVisible();
      expect(csv.suggestedFilename()).toMatch(/-data\.zip$/);
      const csvPath = join(tmpdir(), `export-${size.name}-data.zip`);
      await csv.saveAs(csvPath);
      expect(readFileSync(csvPath).includes('baum.csv')).toBe(true);

      // GeoPackage exportieren: a SQLite file
      await openMenu();
      download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'GeoPackage exportieren' }).click();
      const gpkg = await download;
      await expect(page.getByText('GeoPackage exportiert')).toBeVisible();
      expect(gpkg.suggestedFilename()).toMatch(/\.gpkg$/);
      const gpkgPath = join(tmpdir(), `export-${size.name}.gpkg`);
      await gpkg.saveAs(gpkgPath);
      expect(readFileSync(gpkgPath).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');

      // Gesamtes Projekt importieren (ZIP): the dialog, the name override, the phases, the new card
      await page.getByRole('button', { name: 'Weitere Optionen zum Erstellen' }).click();
      await expect(page.getByRole('menuitem', { name: 'Gesamtes Projekt importieren (ZIP)' })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByTestId('import-archive-file').setInputFiles(zipPath);
      const dialog = page.getByRole('dialog', { name: 'Gesamtes Projekt importieren (ZIP)' });
      await expect(dialog.getByTestId('archive-file')).toContainText(`export-${size.name}.zip`);
      await dialog.getByLabel('Name überschreiben (optional)').fill(`${size.project} Kopie`);
      expect(await scan(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Importieren' }).click();
      await expect(dialog.getByTestId('archive-phase')).toHaveText('Fertig', { timeout: 30_000 });
      await expect(page.getByText('Projektarchiv importiert')).toBeVisible();
      await dialog.getByRole('button', { name: 'Schließen' }).first().click();
      await expect(
        page.locator('[data-slot="card"]').filter({ hasText: `${size.project} Kopie` }),
      ).toHaveCount(1);

      // a file that is no archive: the dialog says why, no project is added
      await page.getByTestId('import-archive-file').setInputFiles(csvPath.replace('-data.zip', '.gpkg'));
      await dialog.getByRole('button', { name: 'Importieren' }).click();
      await expect(dialog.getByTestId('archive-phase')).toHaveText('Fehlgeschlagen', { timeout: 30_000 });
      await expect(dialog.getByTestId('archive-problems')).toBeVisible();
      expect(await scan(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'Schließen' }).first().click();
      await expect(page.locator('[data-slot="card"]')).toHaveCount(2);
    });
  });
}
