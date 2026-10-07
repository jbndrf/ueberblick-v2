import { devices, expect, test, type Page } from '@playwright/test';
import { watchErrors } from './world';
import { CROWD, idsOfType, readState, seedMapWorld, signInMap, ZOOM_MAX, ZOOM_MIN } from './map-world';

/**
 * WP-745: four things that unit tests covered with the inner renderer and that never reached the real map. Each journey
 * runs on the built app with real MapLibre and asserts what MapLibre holds, read back from the map element's
 * `data-map-state` (written from `map.getMinZoom()`, `getLayoutProperty`, `listImages()`, `queryRenderedFeatures`,
 * packages/ui/src/map/maplibre/probe.ts) - never a flag the app sets itself.
 */
const { defaultBrowserType: _unused, ...PIXEL } = devices['Pixel 7'];
void _unused;

test.setTimeout(90_000);

test.beforeAll(async ({ playwright, baseURL }) => {
  await seedMapWorld(playwright, baseURL ?? '');
});

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = watchErrors(page);
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

/** The map has settled with its features drawn (the crowd is one cluster, the benches are singles). */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readState(page))?.clusters, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1);
}

async function wheel(page: Page, deltaY: number): Promise<void> {
  const box = await page.getByTestId('map').boundingBox();
  if (box === null) throw new Error('no map box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(50);
  }
}

for (const [name, use] of [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', PIXEL],
] as const) {
  test.describe(name, () => {
    test.use({ ...use, locale: 'de-DE' });

    test('project zoom limits: MapLibre holds them and zooming past them is clamped (WP-690)', async ({
      page,
    }) => {
      await signInMap(page, `p-zoom-${name}`);
      await settled(page);
      const start = await readState(page);
      expect(start).toMatchObject({ minZoom: ZOOM_MIN, maxZoom: ZOOM_MAX });
      // zoom in until MapLibre stops at the limit, then keep pushing: it must not pass it
      const reach = async (deltaY: number, done: (z: number) => boolean): Promise<void> => {
        for (let i = 0; i < 12 && !done((await readState(page))?.zoom ?? 0); i++) {
          await wheel(page, deltaY);
          await page.waitForTimeout(400);
        }
      };
      await reach(-400, (z) => z > ZOOM_MAX - 0.05);
      expect((await readState(page))?.zoom ?? 0).toBeGreaterThan(ZOOM_MAX - 0.05);
      await wheel(page, -400);
      await wheel(page, -400);
      await page.waitForTimeout(1500);
      expect((await readState(page))?.zoom).toBeLessThanOrEqual(ZOOM_MAX + 0.001);
      await reach(400, (z) => z < ZOOM_MIN + 0.05);
      expect((await readState(page))?.zoom ?? 99).toBeLessThan(ZOOM_MIN + 0.05);
      await wheel(page, 400);
      await wheel(page, 400);
      await page.waitForTimeout(1500);
      expect((await readState(page))?.zoom).toBeGreaterThanOrEqual(ZOOM_MIN - 0.001);
    });

    test('Cluster tab: Gruppierung aufheben changes what MapLibre draws (WP-666)', async ({ page }) => {
      await signInMap(page, `p-cluster-${name}`);
      await settled(page);
      const before = await readState(page);
      expect(before?.clusters).toBe(1);
      expect(before?.singles).toBeLessThanOrEqual(2); // the benches; the crowd is one group
      await page.getByRole('button', { name: 'Filter' }).click();
      const sheet = page.getByRole('dialog', { name: 'Karteninhalt' });
      await sheet.getByRole('tab', { name: 'Cluster' }).click();
      await sheet.getByRole('switch', { name: 'Gruppierung aufheben' }).click();
      await expect(sheet.getByText(/einzeln angezeigt/)).toBeVisible(); // the in-view count
      await expect.poll(async () => (await readState(page))?.clusters, { timeout: 20_000 }).toBe(0);
      expect((await readState(page))?.singles).toBeGreaterThanOrEqual(CROWD);
      await sheet.getByRole('switch', { name: 'Gruppierung aufheben' }).click();
      await expect.poll(async () => (await readState(page))?.clusters, { timeout: 20_000 }).toBe(1);
    });

    test('marker looks: two Objektarten each draw their own registered image (WP-744)', async ({ page }) => {
      await signInMap(page, `p-looks-${name}`);
      await settled(page);
      await expect
        .poll(async () => (await readState(page))?.images.length ?? 0, { timeout: 20_000 })
        .toBeGreaterThan(1);
      const state = await readState(page);
      const expr = state?.iconImage;
      expect(Array.isArray(expr) && expr[0] === 'match').toBe(true);
      const arms = new Map<string, string>();
      const list = expr as unknown[];
      for (let i = 2; i + 1 < list.length; i += 2) arms.set(String(list[i]), String(list[i + 1]));
      const bank = arms.get('bank');
      const baum = [...arms].filter(([k]) => k === 'baum' || k.startsWith('baum|')).map(([, v]) => v);
      expect(bank, 'the Bank has its own arm').toBeDefined();
      expect(baum.length).toBeGreaterThan(0);
      expect(baum).not.toContain(bank);
      for (const id of [bank, ...baum]) expect(state?.images).toContain(id);
    });

    test('relation menu: "Maßnahme anlegen" creates the child, opens it, and the page stays interactive (WP-742)', async ({
      page,
    }) => {
      await signInMap(page, `p-child-${name}`);
      await settled(page);
      const before = idsOfType('massnahme');
      await page.getByRole('button', { name: 'Liste' }).click();
      const parent = page.locator('table.ub-list tr', { hasText: 'Maßnahme' }).locator('.ub-open').first();
      await expect(parent).toBeVisible({ timeout: 30_000 });
      await parent.click();
      if (name === 'desktop') await page.getByRole('button', { name: 'Liste' }).click();
      await expect(page.getByTestId('feature-sheet')).toBeVisible();
      const parentId = await page.getByTestId('map').getAttribute('data-selected');
      await page.getByRole('button', { name: 'Verknüpfte Objekte' }).click();
      await page.getByRole('menuitem', { name: /^Maßnahmen/ }).click();
      await page.getByRole('button', { name: /Maßnahme anlegen/ }).click();
      await page.getByRole('button', { name: /^Art/ }).click();
      await page
        .getByRole('option', { name: 'Kronenschnitt' })
        .or(page.getByRole('radio', { name: 'Kronenschnitt' })) // a list on desktop, a sheet of radios on a phone
        .click();
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => idsOfType('massnahme').length, { timeout: 20_000 }).toBe(before.length + 1);
      // the new child is the open feature, not the parent (the device names it before the server does)
      await expect(page.getByTestId('map')).toHaveAttribute('data-selected', /./);
      await expect(page.getByTestId('map')).not.toHaveAttribute('data-selected', parentId ?? 'none');
      await expect(page.getByTestId('feature-sheet')).toBeVisible();
      await expect(page.getByTestId('feature-sheet')).toContainText('Maßnahme');
      // nothing left over the page: no pointer-events lock on the body, and a click still works
      expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');
      await page.getByRole('button', { name: 'Schließen' }).click();
      await expect(page.getByTestId('feature-sheet')).toBeHidden();
    });
  });
}
