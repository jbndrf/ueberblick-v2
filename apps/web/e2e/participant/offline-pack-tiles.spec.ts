import { devices, expect, type Page } from '@playwright/test';
import { allowErrors, watchErrors } from './world';
import { readState } from './map-world';
import {
  PACK_KEY,
  PROXY_PNG,
  signInTilepack,
  test,
  TILEPACK_KEY,
  START_ZOOM,
} from './helpers/tilepack-world';

/**
 * WP-861 (parity p2.tiles-and-offline-packs-ubtile): where the map's tiles come from. v3 `tile-protocol.ts` (the
 * `ubtile://` protocol: pack on the device first, then the network, then a blurry overzoom of the pack's coarser tile),
 * `SettingsSheet.svelte:644-748` (Kartenkacheln card), `package-selector.svelte` (Offline-Pakete). The map's base layer
 * is an xyz source read through the tile proxy; the proxy answer is cyan, the pack's tiles are magenta, so the pixels
 * of the real map say which source drew them. Phone and desktop, de-DE.
 */
const { defaultBrowserType: _unused, ...PIXEL } = devices['Pixel 7'];
void _unused;

test.setTimeout(120_000);

const TILES = new RegExp(`/api/p/${TILEPACK_KEY}/tiles/`);
const OFFLINE_NOISE =
  /participant sync:open: .*Failed to fetch|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/;

/** Answers the proxy with the cyan fixture and counts what it was asked. */
async function watchProxy(page: Page): Promise<{ count: () => number }> {
  let n = 0;
  await page.route(TILES, (route) => {
    n++;
    return route.fulfill({ status: 200, contentType: 'image/png', body: PROXY_PNG });
  });
  return { count: () => n };
}

/** The share of the map's pixels that are (nearly) `rgb`, read from a screenshot of the real canvas. */
async function share(page: Page, rgb: readonly [number, number, number]): Promise<number> {
  const shot = await page.getByTestId('map').screenshot();
  return page.evaluate(
    async ([b64, want]) => {
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes]));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      if (ctx === null) return 0;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      const w = want as unknown as number[];
      let hit = 0;
      for (let i = 0; i < d.length; i += 4)
        if (
          Math.abs((d[i] ?? 0) - (w[0] ?? 0)) < 24 &&
          Math.abs((d[i + 1] ?? 0) - (w[1] ?? 0)) < 24 &&
          Math.abs((d[i + 2] ?? 0) - (w[2] ?? 0)) < 24
        )
          hit++;
      return hit / (d.length / 4);
    },
    [shot.toString('base64'), rgb] as const,
  );
}
const MAGENTA = [255, 0, 255] as const;
const CYAN = [0, 255, 255] as const;
const DRAWN = 0.2;

async function zoomTo(page: Page, atLeast: number): Promise<void> {
  const box = await page.getByTestId('map').boundingBox();
  if (box === null) throw new Error('no map box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20 && ((await readState(page))?.zoom ?? 0) < atLeast; i++) {
    for (let k = 0; k < 4; k++) {
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(500);
  }
}

async function downloadPack(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Einstellungen' });
  await sheet.getByRole('tab', { name: 'Offline' }).click();
  const card = sheet.getByTestId('tiles-card');
  await card.getByRole('button', { name: 'Kacheln herunterladen' }).click();
  const dialog = page.getByTestId('package-dialog');
  const row = dialog.locator(`[data-testid="pack-row"][data-pack="${PACK_KEY}"]`);
  await row.getByRole('button', { name: 'Herunterladen' }).click();
  await expect(row).toContainText('Heruntergeladen', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Schließen' }).last().click();
  await expect(card.locator(`[data-testid="ready-pack"][data-pack="${PACK_KEY}"]`)).toBeVisible();
  await sheet.getByRole('button', { name: 'Schließen' }).last().click();
}

for (const [size, use] of [
  ['phone', PIXEL],
  ['desktop', { viewport: { width: 1280, height: 800 } }],
] as const) {
  test.describe(size, () => {
    test.use({ ...use, locale: 'de-DE' });
    let problems: string[] = [];
    test.beforeEach(({ page }) => {
      problems = watchErrors(page);
    });
    test.afterEach(() => {
      expect(problems).toEqual([]);
    });

    test('online without a pack the tiles come from the proxy', async ({ page, world }, info) => {
      expect(world).toBe(true);
      const proxy = await watchProxy(page);
      await signInTilepack(page, `p-net-${size}-${info.repeatEachIndex}-${info.retry}`);
      await expect.poll(() => share(page, CYAN), { timeout: 30_000 }).toBeGreaterThan(DRAWN);
      expect(proxy.count()).toBeGreaterThan(0);
      expect(await share(page, MAGENTA)).toBeLessThan(0.01);
    });

    test('with the network off, tiles come from the device pack and the proxy gets no request; past the pack the tile is overzoomed', async ({
      page,
      context,
      world,
    }, info) => {
      expect(world).toBe(true);
      const proxy = await watchProxy(page);
      await signInTilepack(page, `p-pack-${size}-${info.repeatEachIndex}-${info.retry}`);
      await downloadPack(page);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 30_000,
      });
      allowErrors(problems, OFFLINE_NOISE);
      await context.setOffline(true);
      const before = proxy.count();
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      // inside the pack: its tiles are drawn, the proxy is not asked
      await expect.poll(() => share(page, MAGENTA), { timeout: 30_000 }).toBeGreaterThan(DRAWN);
      expect(await share(page, CYAN)).toBeLessThan(0.01);
      expect(proxy.count()).toBe(before);
      // past the pack's last zoom the tile is cut from the pack's coarser one: still the pack's colour, no error
      await zoomTo(page, START_ZOOM + 1.5);
      expect((await readState(page))?.zoom ?? 0).toBeGreaterThan(START_ZOOM + 1);
      await expect.poll(() => share(page, MAGENTA), { timeout: 30_000 }).toBeGreaterThan(DRAWN);
      expect(proxy.count()).toBe(before);
      await context.setOffline(false);
    });

    test('with the network off, panning past the pack bounds logs no error and leaves the base blank there', async ({
      page,
      context,
      world,
    }, info) => {
      expect(world).toBe(true);
      await watchProxy(page);
      await signInTilepack(page, `p-edge-${size}-${info.repeatEachIndex}-${info.retry}`);
      await downloadPack(page);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 30_000,
      });
      allowErrors(problems, OFFLINE_NOISE);
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      await expect.poll(() => share(page, MAGENTA), { timeout: 30_000 }).toBeGreaterThan(DRAWN);
      // drag the map far across the pack's edge: those tiles have no pack and no network
      const box = await page.getByTestId('map').boundingBox();
      if (box === null) throw new Error('no map box');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      for (let i = 0; i < 6; i++) {
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx - box.width * 0.45, cy, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(1500);
      // outside the pack the base is blank (no cyan from the proxy, which is unreachable offline)
      expect(await share(page, CYAN)).toBeLessThan(0.01);
      await context.setOffline(false);
    });
  });
}
