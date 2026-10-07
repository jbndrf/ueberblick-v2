// WP-646: Standort's accuracy circle and dot on the real map, at phone 390x844 and desktop 1280x800.
import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page, query = ''): Promise<void> => {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => document.querySelector('.maplibregl-canvas') !== null);
  await page.waitForTimeout(400);
};

/** The RGB of the screen pixels at the given offsets from the middle of the map (read from a screenshot). */
const pixels = async (page: Page, offsets: number[]): Promise<number[][]> => {
  const png = (await page.screenshot()).toString('base64');
  const vp = page.viewportSize();
  if (vp === null) throw new Error('no viewport');
  return page.evaluate(
    async ({ png, offsets, cx, cy }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (ctx === null) throw new Error('no 2d');
      ctx.drawImage(img, 0, 0);
      const k = img.width / window.innerWidth;
      return offsets.map((dx) =>
        Array.from(ctx.getImageData(Math.round((cx + dx) * k), Math.round(cy * k), 1, 1).data.slice(0, 3)),
      );
    },
    { png, offsets, cx: vp.width / 2, cy: vp.height / 2 },
  );
};
/** Pixel radius of `metres` at MapLibre zoom `z` and latitude 50.7. */
const radiusPx = (metres: number, z: number): number =>
  metres / ((78271.517 * Math.cos((50.7 * Math.PI) / 180)) / 2 ** z);

test('Standort centres at v3 zoom and draws a white-ringed blue dot with a faint circle in true metres', async ({
  page,
}) => {
  await open(page);
  const before = Number(await page.evaluate(() => document.body.dataset['zoom']));
  await page.getByRole('button', { name: 'Standort' }).click();
  await page.waitForTimeout(1500);
  const width = Number(await page.evaluate(() => document.body.dataset['zoom']));
  expect(width).toBeLessThan(before / 4); // zoomed in from 12 to 15
  const r = radiusPx(100, 15);
  const [dot, ring, inside, outside, far] = await pixels(page, [0, 8, r * 0.6, r * 1.4, 185]);
  expect(dot).toEqual([66, 133, 244]); // #4285F4
  expect(ring?.every((v) => v > 200)).toBe(true); // white ring
  expect(inside).not.toEqual(far); // tinted by the 10 % blue fill
  expect(inside?.[2]).toBeGreaterThanOrEqual(inside?.[0] ?? 0);
  expect(outside).toEqual(far); // the plain map background
});

test('the circle grows with the zoom (true metres), the dot stays the same size', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Standort' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Zoom +1' }).click();
  await page.waitForTimeout(800);
  const r = radiusPx(100, 16);
  const [inside, outside, dot, ring, far] = await pixels(page, [r * 0.9, r * 1.15, 0, 8, 188]);
  expect(inside).not.toEqual(far);
  expect(outside).toEqual(far); // the plain map background
  expect(dot).toEqual([66, 133, 244]);
  expect(ring?.every((v) => v > 200)).toBe(true);
});

test('a device that cannot tell leaves the map where it is and says so', async ({ page }) => {
  await open(page, 'fail=1');
  const before = await page.evaluate(() => document.body.dataset['zoom']);
  await page.getByRole('button', { name: 'Standort' }).click();
  await expect(page.getByRole('status')).toHaveText('Standort nicht verfügbar');
  expect(await page.evaluate(() => document.body.dataset['zoom'])).toBe(before);
});
