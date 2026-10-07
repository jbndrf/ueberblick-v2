// WP-674 (B-018): the real map draws each feature in the icon or colour of its value, the area in the value's colour, and
// a value with none in the type's marker colour. Pixels of a screenshot are read in the page, at phone 390x844 and
// desktop 1280x800.
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../../e2e/a11y/axe';

const POINTS = { p1: [7.97, 50.02], p2: [7.99, 50.02], p3: [8.01, 50.02], p4: [8.03, 50.02] } as const;
const BAUM = [8, 50.04] as const;
const AREA = [8.03, 49.98] as const;
type Rgb = readonly [number, number, number];
const GREEN: Rgb = [22, 163, 74];
const RED: Rgb = [220, 38, 38];
const YELLOW: Rgb = [202, 138, 4];
const BLUE: Rgb = [51, 102, 153];
const MAGENTA: Rgb = [162, 28, 175];

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
}

/** The share of pixels within `tol` of `rgb` in a square of `half` px around the projected position, read from a screenshot. */
async function share(
  page: Page,
  at: readonly [number, number],
  rgb: Rgb,
  half = 14,
  tol = 40,
): Promise<number> {
  const point = await page.evaluate((a) => {
    const h = (
      window as unknown as {
        __handle: { project(p: [number, number]): { x: number; y: number } | undefined };
      }
    ).__handle;
    return h.project([a[0], a[1]]);
  }, at);
  if (point === undefined) throw new Error('not projected');
  const shot = (await page.screenshot()).toString('base64');
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  return page.evaluate(
    async ({ b64, p, d, color, half: r, tolerance }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const x0 = Math.max(0, Math.round((p.x - r) * d));
      const y0 = Math.max(0, Math.round((p.y - r) * d));
      const data = ctx.getImageData(x0, y0, Math.round(2 * r * d), Math.round(2 * r * d)).data;
      let hit = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs((data[i] as number) - color[0]) <= tolerance &&
          Math.abs((data[i + 1] as number) - color[1]) <= tolerance &&
          Math.abs((data[i + 2] as number) - color[2]) <= tolerance
        )
          hit++;
      }
      return hit / (data.length / 4);
    },
    { b64: shot, p: point, d: dpr, color: rgb, half, tolerance: tol },
  );
}

const seen = async (page: Page, at: readonly [number, number], rgb: Rgb, half?: number): Promise<void> => {
  await expect.poll(() => share(page, at, rgb, half), { timeout: 15000 }).toBeGreaterThan(0.01);
};

test('a feature is drawn in the icon colour of its value, a plain value as a dot in its colour', async ({
  page,
}) => {
  await open(page);
  await seen(page, POINTS.p1, GREEN); // leaf stroked in the value colour
  await seen(page, POINTS.p2, RED, 20); // triangle-alert, size 40
  await seen(page, POINTS.p3, YELLOW); // no icon: a dot in the value colour
});

test('a value the type does not list is drawn in the type marker colour; the other colours are not there', async ({
  page,
}) => {
  await open(page);
  await seen(page, POINTS.p4, BLUE);
  expect(await share(page, POINTS.p4, GREEN)).toBe(0);
  expect(await share(page, POINTS.p1, RED)).toBe(0);
});

test('a feature of another Objektart is drawn in its own look, even where the property name is shared (WP-744)', async ({
  page,
}) => {
  await open(page);
  await seen(page, BAUM, MAGENTA);
  expect(await share(page, BAUM, GREEN)).toBe(0); // not the first type's look for the value "gut"
  expect(await share(page, POINTS.p1, MAGENTA)).toBe(0);
});

test('looks given again are drawn without reload, the images of the new look included (WP-744)', async ({
  page,
}) => {
  await open(page);
  await seen(page, BAUM, MAGENTA);
  await page.evaluate(() => (window as unknown as { __relook: () => void }).__relook());
  await seen(page, BAUM, RED);
  expect(await share(page, BAUM, MAGENTA)).toBe(0);
});

test('an area is filled in the colour of its value', async ({ page }) => {
  await open(page);
  await seen(page, AREA, RED, 6);
});

/** A real tap at a position; the target it resolved to (a feature id, or 'map'). */
async function tapAt(page: Page, at: readonly [number, number]): Promise<string | undefined> {
  const p = await page.evaluate((a) => {
    const h = (window as unknown as { __handle: { project(p: [number, number]): { x: number; y: number } } })
      .__handle;
    const box = (document.getElementById('map') as HTMLElement).getBoundingClientRect();
    const q = h.project([a[0], a[1]]);
    return { x: q.x + box.left, y: q.y + box.top };
  }, at);
  await page.evaluate(() => ((window as unknown as { __taps: string[] }).__taps.length = 0));
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __taps: string[] }).__taps.length))
    .toBeGreaterThan(0);
  return page.evaluate(() => (window as unknown as { __taps: string[] }).__taps[0]);
}

test('a tap inside an area takes the point, then the line, then the area (WP-688)', async ({ page }) => {
  await open(page);
  await seen(page, POINTS.p1, GREEN); // the map is drawn
  expect(await tapAt(page, [7.975, 49.985])).toBe('p5'); // a point inside the area
  expect(await tapAt(page, [7.965, 49.97])).toBe('l1'); // a line inside the area
  expect(await tapAt(page, [7.99, 49.97])).toBe('fl2'); // the bare area
  expect(await tapAt(page, [7.99, 50.005])).toBe('map'); // nothing
});

test('a tool that owns the tap gets the position over a point inside an area (WP-698)', async ({ page }) => {
  await open(page);
  await seen(page, POINTS.p1, GREEN);
  const capture = (on: boolean): Promise<void> =>
    page.evaluate(
      (v) => (window as unknown as { __handle: { captureTaps(on: boolean): void } }).__handle.captureTaps(v),
      on,
    );
  await capture(true);
  expect(await tapAt(page, [7.975, 49.985])).toBe('map'); // the tree inside the area: the pin goes there
  expect(await tapAt(page, [7.99, 49.97])).toBe('map'); // the bare area
  await capture(false);
  expect(await tapAt(page, [7.975, 49.985])).toBe('p5');
});

test('has no axe violations', async ({ page }) => {
  await open(page);
  const violations = await axeViolations(page, {
    scope: 'body',
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(violations).toEqual([]);
});
