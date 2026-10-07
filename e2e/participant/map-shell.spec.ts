import { expect, test, type Page } from '@playwright/test';
import { CAMERA_CENTER, mapToken } from './map-world';
import { qrLink, seedWorld } from './world';

/**
 * WP-620: v3's map screen on a phone. The bottom bar has Layer, Filter, +, Standort, Werkzeuge, Einstellungen in this
 * order (Werkzeuge because the role has a tool); Standort centres the map on the device position (faked here) and says
 * when the device cannot tell; the journey sign-in, map, open a feature works with a tap on the map.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

async function openMap(page: Page) {
  await page.goto(qrLink(mapToken()));
  await expect(page).toHaveURL(/\/map$/);
  const map = page.getByTestId('map');
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(map).toHaveAttribute('data-idle', { timeout: 30_000 });
  return map;
}

const bar = (page: Page) => page.getByRole('navigation', { name: 'Map bar' });

test('the bar has v3 order and the header names the project', async ({ page }) => {
  await openMap(page);
  await expect(page.getByRole('banner')).toContainText('karte');
  const names = await bar(page)
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? e.getAttribute('aria-label')));
  expect(names).toEqual(['Layers', 'Filters', 'New', 'Location', 'Tools', 'Settings']);
});

test('Standort centres the map on the device position', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 50.75, longitude: 7.2 });
  const map = await openMap(page);
  await bar(page)
    .getByRole('button', { name: /Location/ })
    .click();
  await expect
    .poll(
      async () => {
        const [lon, lat] = ((await map.getAttribute('data-center')) ?? '0,0').split(',').map(Number);
        return Math.hypot((lon ?? 0) - 7.2, (lat ?? 0) - 50.75);
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(1e-3);
});

test('Standort without permission says the location is not available', async ({ page, context }) => {
  await context.clearPermissions();
  await openMap(page);
  await bar(page)
    .getByRole('button', { name: /Location/ })
    .click();
  await expect(page.getByText('Location not available')).toBeVisible({ timeout: 20_000 });
});

test('journey: sign in, see the map, tap the tree, its feature sheet opens', async ({ page }) => {
  const map = await openMap(page);
  const centre = (await map.getAttribute('data-center')) ?? '';
  const [lon, lat] = centre.split(',').map(Number);
  expect(Math.hypot((lon ?? 0) - CAMERA_CENTER[0], (lat ?? 0) - CAMERA_CENTER[1])).toBeLessThan(1e-6);
  const box = await map.boundingBox();
  if (box === null) throw new Error('no map box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog', { name: /^Tree #/ })).toBeVisible();
});

test('Filter opens Map content and Settings opens its sheet; Escape closes a sheet before the next opens (v3: sheets are modal)', async ({
  page,
}) => {
  await openMap(page);
  await bar(page)
    .getByRole('button', { name: /Filters/ })
    .click();
  const filter = page.getByRole('dialog', { name: 'Map content' });
  await expect(filter).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(filter).toBeHidden();
  await bar(page)
    .getByRole('button', { name: /Settings/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});
