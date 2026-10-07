import { expect, test, type Page } from '@playwright/test';
import { goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-390 (S3-23, E-11): v3's 'GeoJSON importieren' from the Objektarten "+" menu, at phone and desktop size: upload,
 * Prüfen (name, inferred field types, an override), 'Veröffentlichen und importieren' (the new Objektart goes into
 * the draft, the draft is published, the features are imported as runs) and the data page of the new Objektart.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

test.use({ locale: 'de-DE' });

const FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.1, 50.1] },
      properties: { art: 'Eiche', hoehe: 12.5, gepflanzt: '2020-05-01', geschuetzt: true },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.2, 50.2] },
      properties: { art: 'Linde', hoehe: 8, gepflanzt: '2019-03-15', geschuetzt: false },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.3, 50.3] },
      properties: { art: 'Buche', hoehe: 20, gepflanzt: '2001-11-30', geschuetzt: true },
    },
  ],
});

let admins = 0;
test.beforeAll(() => {
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
});

const noScroll = async (page: Page): Promise<void> => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};

/** At phone size the sidebar is a sheet: open it when it is closed. */
async function openSidebar(page: Page): Promise<void> {
  if (await page.getByTestId('group-types').isVisible()) return;
  await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
  await expect(page.getByTestId('group-types')).toBeVisible();
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('a FeatureCollection becomes a new Objektart: draft, publish, import, data page', async ({
      page,
    }) => {
      const stamp = Date.now().toString(36);
      const email = `geojson${(admins += 1)}-${stamp}@example.org`;
      createAdmin(email);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Geo neu ${name} ${stamp}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `geo_neu_${name}_${stamp}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));

      // v3's place: the Objektarten "+" menu, third item.
      await openSidebar(page);
      await page.getByTestId('group-types').getByRole('button', { name: 'Objektart hinzufügen' }).click();
      await page.getByRole('menuitem', { name: 'GeoJSON importieren' }).click();
      const dialog = page.getByTestId('geojson-dialog');
      await expect(dialog.getByText('GeoJSON importieren')).toBeVisible();

      // v3's errors: not JSON, not a FeatureCollection, no features.
      const file = page.getByTestId('geojson-file');
      await file.setInputFiles({
        name: 'kaputt.geojson',
        mimeType: 'application/json',
        buffer: Buffer.from('{nope'),
      });
      await expect(dialog.getByText('Die Datei konnte nicht als JSON gelesen werden.')).toBeVisible();
      await file.setInputFiles({
        name: 'punkt.geojson',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ type: 'Point', coordinates: [1, 2] })),
      });
      await expect(dialog.getByText(/Die Datei ist keine GeoJSON-FeatureCollection/)).toBeVisible();
      await file.setInputFiles({
        name: 'leer.geojson',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [] })),
      });
      await expect(dialog.getByText('Die Datei enthält keine Features.')).toBeVisible();

      // Prüfen: the name from the file, the count, the geometry and the inferred types.
      await file.setInputFiles({
        name: 'hochstaemme.geojson',
        mimeType: 'application/geo+json',
        buffer: Buffer.from(FC),
      });
      await expect(page.getByTestId('geojson-name')).toHaveValue('hochstaemme');
      await expect(page.getByTestId('geojson-summary')).toContainText('3 Features');
      await expect(page.getByTestId('geojson-summary')).toContainText('Geometrietyp: Point');
      await expect(page.getByTestId('geojson-type-0')).toHaveValue('text');
      await expect(page.getByTestId('geojson-type-1')).toHaveValue('number');
      await expect(page.getByTestId('geojson-type-2')).toHaveValue('date');
      await expect(page.getByTestId('geojson-type-3')).toHaveValue('boolean');
      await page.getByTestId('geojson-name').fill('Hochstämme');
      await page.getByTestId('geojson-type-3').selectOption('text'); // an override, as in v3's select
      await noScroll(page);
      await expect(page.getByTestId('geojson-unpublished')).toBeVisible();

      // 'Veröffentlichen und importieren': progress, then the result.
      await page.getByTestId('geojson-import').click();
      await expect(page.getByTestId('import-result')).toContainText('GeoJSON importiert (3 Features)');
      await noScroll(page);
      await page.getByTestId('import-table').click();

      // The new Objektart: in the sidebar, its data page lists the three features.
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/types/hochstaemme$`));
      await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(3);
      await expect(page.getByText('Eiche')).toBeVisible();
      await openSidebar(page);
      await expect(page.getByTestId('group-types').getByRole('link', { name: 'Hochstämme' })).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeHidden();
    });
  });
}
