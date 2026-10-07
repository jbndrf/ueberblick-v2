import { expect, test, type Locator, type Page } from '@playwright/test';
import { CAMERA_CENTER, mapToken } from './map-world';
import { qrLink, seedWorld } from './world';

/**
 * WP-592: the map is visible in the real app. Nothing imported MapLibre's stylesheet, so the map container stayed
 * `position: static` and the canvas grew far beyond the screen. Project `karte` has a map view with an inline style
 * and a camera on the seeded tree (the camera itself is proven by unit tests).
 *
 * WP-585, WP-620: a map that draws cannot be read through the DOM. The camera is read where `MapCanvas` writes the
 * settled camera: `data-center` with `data-idle` on the map container, set when the map is ready and on every
 * `moveend` (the only camera signal the renderer reports). A test waits on that seam, never on a tap.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

async function openMap(page: Page) {
  await page.goto(qrLink(mapToken()));
  await expect(page).toHaveURL(/\/map$/);
  const map = page.getByTestId('map');
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  // settled: the camera centre is written (data-idle), so a test can read where the map looks
  await expect(map).toHaveAttribute('data-idle', { timeout: 30_000 });
  return map;
}

/** The camera centre the map is settled on (the seam above): [lon, lat]. */
async function centre(map: Locator): Promise<readonly [number, number]> {
  const c = await map.getAttribute('data-center');
  if (c === null) throw new Error('the map has no data-center yet');
  const [lon, lat] = c.split(',').map(Number);
  return [lon, lat];
}

/** Degrees between two centres; the map's own numbers, so no projection. */
const dist = (a: readonly [number, number], b: readonly [number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

test('the map has the MapLibre stylesheet: a positioned container and a canvas that fits the screen', async ({
  page,
}) => {
  const map = await openMap(page);
  const canvas = map.locator('canvas.maplibregl-canvas');

  expect(await map.evaluate((el) => getComputedStyle(el).position)).not.toBe('static');
  const viewport = page.viewportSize();
  const box = await canvas.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box?.width ?? Infinity).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  expect(box?.height ?? Infinity).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
});

test('the map opens at the view camera and a tap on the tree opens its feature sheet', async ({ page }) => {
  const map = await openMap(page);
  const sheet = page.getByRole('dialog', { name: /^Tree #/ });

  // the camera opens on the tree: the settled centre the seam writes is the tree
  expect(dist(await centre(map), CAMERA_CENTER)).toBeLessThan(1e-6);

  // one tap on the idle map at its centre opens the tree
  const box = await map.boundingBox();
  if (box === null) throw new Error('no map box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('map')).toBeVisible();
});
