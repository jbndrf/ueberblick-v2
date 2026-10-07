import { expect, test, type Locator, type Page } from '@playwright/test';
import { CAMERA_CENTER, FINDING, mapToken } from './map-world';
import { qrLink, seedWorld } from './world';

/**
 * WP-655: Werkzeuge and the tool switches (v3 ToolsSheet, AdvancedFeaturesPanel) at both sizes, phone 390x844 and
 * desktop 1280x800. Role `kontrolle` has Search active and Measure offered (map-world). Measure and Search on the
 * mounted map were lost with the first-build shell (WP-620); they are back here. The map is read as in map.spec: the
 * settled camera (`data-center`, `data-idle`), and Measure's overlay as a change of the map's pixels.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, hasTouch: false },
] as const;

async function openMap(page: Page, url: string = qrLink(mapToken())): Promise<Locator> {
  await page.goto(url);
  await expect(page).toHaveURL(/\/map$/);
  const map = page.getByTestId('map');
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(map).toHaveAttribute('data-idle', { timeout: 30_000 });
  return map;
}

async function centre(map: Locator): Promise<readonly [number, number]> {
  const c = await map.getAttribute('data-center');
  if (c === null) throw new Error('the map has no data-center yet');
  const [lon, lat] = c.split(',').map(Number);
  return [lon, lat];
}
const dist = (a: readonly [number, number], b: readonly [number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The Werkzeuge button: the bottom bar on a phone, the header from md (the other one is not displayed). */
const toolsButton = (page: Page) => page.getByRole('button', { name: 'Tools', exact: true });
const toolsSheet = (page: Page) => page.getByRole('dialog', { name: 'Tools', exact: true });
const settingsSheet = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

/** Settings -> Options -> Advanced features, opened. */
async function openSwitches(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const sheet = settingsSheet(page);
  await sheet.getByRole('tab', { name: 'Options' }).click();
  await sheet.getByRole('button', { name: /Advanced features/ }).click();
  return sheet;
}

/** A switch is kept on the server: wait for the PATCH of the preference record. */
const saved = (page: Page) =>
  page.waitForResponse((r) => r.url().includes('/prefs') && r.request().method() === 'PATCH');

for (const size of SIZES) {
  test.describe(`Werkzeuge on ${size.name}`, () => {
    test.use({ viewport: size.viewport, hasTouch: size.hasTouch });

    test('the sheet is a tile grid of the tools that are on; Search finds the tree and centres the map on it', async ({
      page,
    }) => {
      const map = await openMap(page);
      await expect(toolsButton(page)).toBeVisible();
      await toolsButton(page).click();
      const sheet = toolsSheet(page);
      await expect(sheet).toBeVisible();
      // v3 look: a narrow right-hand sheet, one tile per tool; Measure is offered, not on
      const box = await sheet.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(size.name === 'phone' ? 120 : 140);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(size.viewport.width - 2);
      await expect(sheet.getByRole('button', { name: 'Search' })).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Measure' })).toHaveCount(0);

      await sheet.getByRole('button', { name: 'Search' }).click();
      const panel = page.getByRole('dialog', { name: 'Search' });
      await expect(panel).toBeVisible();
      await expect(sheet).toBeHidden();
      await panel.getByRole('searchbox').fill(FINDING.split(' ')[0] ?? FINDING);
      await panel.getByRole('button', { name: /Hohlraum/ }).click();
      // the result opened the feature sheet and closed the panel
      await expect(page.getByRole('dialog', { name: /^Tree #/ })).toBeVisible();
      await expect(panel).toBeHidden();
      await expect
        .poll(async () => dist(await centre(map), CAMERA_CENTER), { timeout: 10_000 })
        .toBeLessThan(1e-6);
    });

    test('Einstellungen switches Measure on, it is kept for the person, Measure draws on the map; switching it off removes the tile', async ({
      page,
    }) => {
      const map = await openMap(page);
      const sheet = await openSwitches(page);
      const measure = sheet.getByRole('switch', { name: 'Measure' });
      await expect(measure).toHaveAttribute('aria-checked', 'false'); // offered: off at first
      await expect(sheet.getByRole('switch', { name: 'Search' })).toHaveAttribute('aria-checked', 'true'); // active: on
      const sent = saved(page);
      await measure.click();
      await expect(measure).toHaveAttribute('aria-checked', 'true');
      expect((await sent).ok()).toBe(true);
      await page.keyboard.press('Escape');
      await expect(settingsSheet(page)).toBeHidden();

      // follows the person: still on after a reload (the record comes from the server or the device cache)
      await openMap(page, '/map');
      const bare = await map.screenshot();
      await toolsButton(page).click();
      await expect(toolsSheet(page).getByRole('button', { name: 'Measure' })).toBeVisible();
      await toolsSheet(page).getByRole('button', { name: 'Measure' }).click();
      const panel = page.getByRole('dialog', { name: 'Measure' });
      await expect(panel).toBeVisible();
      await expect(toolsSheet(page)).toBeHidden();

      const box = await map.boundingBox();
      if (box === null) throw new Error('no map box');
      // the panel sits at the bottom: tap the top of the map, away from the tree in the middle
      await page.mouse.click(box.x + box.width * 0.2, box.y + 30);
      await page.mouse.click(box.x + box.width * 0.8, box.y + 30);
      await expect(panel.getByText(/Total: .*(m|km)/)).toBeVisible();
      await expect.poll(async () => (await map.screenshot()).equals(bare)).toBe(false);
      await panel.getByRole('button', { name: 'Close' }).click();
      await expect(panel).toBeHidden();
      await expect.poll(async () => (await map.screenshot()).equals(bare), { timeout: 10_000 }).toBe(true);

      // and off again (leaves the person as the next test finds it)
      const sheet2 = await openSwitches(page);
      const off = saved(page);
      await sheet2.getByRole('switch', { name: 'Measure' }).click();
      expect((await off).ok()).toBe(true);
      await page.keyboard.press('Escape');
      await toolsButton(page).click();
      await expect(toolsSheet(page).getByRole('button', { name: 'Measure' })).toHaveCount(0);
    });
  });
}
