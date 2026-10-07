import { expect, test, type Page } from '@playwright/test';
import { CAMERA_CENTER, mapToken } from './map-world';
import { qrLink, seedWorld } from './world';

/**
 * WP-631: the offline cold start. Sign in online, let the worker take control, go offline, reload `/map`: the map and
 * the cached tree show (the shell comes from the worker's cache, the device data from IndexedDB). Run at phone and
 * desktop size (v3 switches at 768 px). Also: the manifest is served and the data endpoints are never cached.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

async function openMap(page: Page) {
  const map = page.getByTestId('map');
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(map).toHaveAttribute('data-idle', { timeout: 30_000 });
  return map;
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport });

    test('signed in online, then offline: a reload shows the map and the cached tree', async ({
      page,
      context,
    }) => {
      await page.goto(qrLink(mapToken()));
      await expect(page).toHaveURL(/\/map$/);
      await openMap(page);
      // the worker installed (shells and build cached) and took control of this page
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 30_000,
      });

      await context.setOffline(true);
      const started = Date.now();
      await page.reload();
      const map = await openMap(page);
      console.log(`offline cold start (${size.name}): ${Date.now() - started} ms to the settled map`);

      const [lon, lat] = ((await map.getAttribute('data-center')) ?? '0,0').split(',').map(Number);
      expect(Math.hypot((lon ?? 0) - CAMERA_CENTER[0], (lat ?? 0) - CAMERA_CENTER[1])).toBeLessThan(1e-6);
      const box = await map.boundingBox();
      if (box === null) throw new Error('no map box');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.getByRole('dialog', { name: /^Tree #/ })).toBeVisible();
      await context.setOffline(false);
    });
  });
}

test('the manifest is served and the data endpoints are not in any cache', async ({ page, request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect(((await manifest.json()) as { start_url: string }).start_url).toBe('/map');

  await page.goto(qrLink(mapToken()));
  await openMap(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached).toContain('/map');
  expect(cached).toContain('/login');
  expect(cached.filter((p) => p.startsWith('/api/') || p.startsWith('/participant-api/'))).toEqual([]);
});
