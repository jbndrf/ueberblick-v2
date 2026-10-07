import { expect, test, type Page } from '@playwright/test';
import { mapToken } from './map-world';
import { qrLink, seedWorld } from './world';

/**
 * WP-621: the Kartenlayer sheet in a real browser at v3's two sizes (phone 390x844, desktop 1280x800; v3 switches at
 * 768 px): only the layers for the person's role, a base swap, an overlay switch, the choice survives a reload, and the
 * sheet is a side sheet over a map that stays usable. The map world holds a second base (Aerial), the overlay
 * Parcels, and the overlay "Admin only" for the role `verwaltung`; the participant is `kontrolle`.
 */
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

async function openMap(page: Page) {
  await page.goto(qrLink(mapToken()));
  await expect(page).toHaveURL(/\/map$/);
  const map = page.getByTestId('map');
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(map).toHaveAttribute('data-idle', { timeout: 30_000 });
}

/** A click that changes the record, finished when the server has it (the choice follows the person, so the next test's fresh device must find the start state again). */
async function savedBy(page: Page, click: () => Promise<void>) {
  const saved = page.waitForResponse((r) => r.url().includes('/prefs') && r.request().method() === 'PATCH');
  await click();
  await saved;
}

async function openLayers(page: Page, width: number) {
  // the bottom bar below 768 px, the header above (v3 `+layout`)
  const button =
    width < 768
      ? page.getByRole('navigation', { name: 'Map bar' }).getByRole('button', { name: /Layers/ })
      : page.getByRole('banner').getByRole('button', { name: 'Map Layers' });
  await button.click();
  const sheet = page.getByRole('dialog', { name: 'Map layers' });
  await expect(sheet).toBeVisible();
  return sheet;
}

for (const size of SIZES) {
  test.describe(`at ${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.width < 768 });

    test('Kartenlayer: role filter, base swap, overlay switch, remembered across a reload (it is a personal preference)', async ({
      page,
    }) => {
      await openMap(page);
      let sheet = await openLayers(page, size.width);

      await expect(sheet.getByRole('radio', { name: 'Street map' })).toBeChecked();
      await expect(sheet.getByRole('radio', { name: 'Aerial' })).not.toBeChecked();
      await expect(sheet.getByRole('switch', { name: 'Parcels' })).not.toBeChecked();
      await expect(sheet.getByText('Admin only')).toHaveCount(0); // the layer of another role
      await expect(page.getByTestId('map')).toBeVisible(); // a side sheet, no overlay: the map stays usable

      await savedBy(page, () => sheet.getByRole('radio', { name: 'Aerial' }).click());
      await savedBy(page, () => sheet.getByRole('switch', { name: 'Parcels' }).click());
      await expect(sheet.getByRole('radio', { name: 'Aerial' })).toBeChecked();
      await expect(sheet.getByRole('radio', { name: 'Street map' })).not.toBeChecked();
      await expect(sheet.getByRole('switch', { name: 'Parcels' })).toBeChecked();

      await page.reload();
      await openMap(page);
      sheet = await openLayers(page, size.width);
      await expect(sheet.getByRole('radio', { name: 'Aerial' })).toBeChecked();
      await expect(sheet.getByRole('switch', { name: 'Parcels' })).toBeChecked();

      // back to the start state for the next test: its device is new, and the choice follows the person
      await savedBy(page, () => sheet.getByRole('radio', { name: 'Street map' }).click());
      await savedBy(page, () => sheet.getByRole('switch', { name: 'Parcels' }).click());
    });
  });
}

// WP-689: the browser asks this server for the tiles of the base map, never the provider (the CSP no longer lists it).
test('a raster tile of the base map loads through the proxy, never from the provider', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => void requested.push(r.url()));
  const proxied = /\/api\/p\/karte\/tiles\/[^/]+\/\d+\/\d+\/\d+/;
  const tile = page.waitForResponse((r) => proxied.test(r.url()), { timeout: 30_000 });
  await openMap(page);
  const response = await tile;
  expect(response.ok()).toBe(true);
  expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
  expect(requested.filter((u) => u.includes('tile.openstreetmap.org'))).toEqual([]);
});
