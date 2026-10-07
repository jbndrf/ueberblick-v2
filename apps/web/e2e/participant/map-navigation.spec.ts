import { devices, expect, test as base, type Page } from '@playwright/test';
import { RECENT_MIN_ZOOM } from '../../src/lib/participant/sheets/recent/fly';
import { watchErrors } from './world';
import { readState } from './map-world';
import {
  BASES,
  CENTER,
  CROWD,
  OVERLAY,
  SPLIT,
  centerOf,
  crowdSettled,
  seedNavWorld,
  signInNav,
} from './navigation-world';

/**
 * WP-758: the step-2 map journeys that only component specs proved, on the built app with real MapLibre. What MapLibre
 * holds is read back from `data-map-state` and `data-center` (e2e build only). Each journey runs on a Pixel 7 and on a
 * 1280x800 desktop, `de-DE`, and fails on any console error.
 *
 * v3 sources: cluster detail `ClusterDetailModule.svelte:21-66`, `map/+page.svelte:1914` (double tap); Zuletzt
 * `RecentSheet.svelte:142-196`, `+page.svelte:298`; Standort `+page.svelte:2445`; layers `LayerSheet.svelte:3-42`;
 * language `language-selector-inline.svelte:14`.
 */
const { defaultBrowserType: _unused, ...PIXEL } = devices['Pixel 7'];
void _unused;
/** A 1x1 transparent PNG: stands in for the overlay's tiles (the e2e server has no upstream). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const START_ZOOM = 10;
const POSITION_ZOOM = 15;
const HERE = { latitude: 51.2, longitude: 10.5 } as const;

const test = base.extend<object, { world: true }>({
  world: [
    async ({ playwright }, use) => {
      await seedNavWorld(playwright);
      await use(true);
    },
    { scope: 'worker' },
  ],
});
test.setTimeout(90_000);

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = watchErrors(page);
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

type Size = 'desktop' | 'phone';
/** The map functions sit in the header on a desktop and in the bottom bar on a phone, under v3's names. */
const NAMES: Record<Size, Record<'layers' | 'recent' | 'location' | 'settings', string>> = {
  desktop: {
    layers: 'Kartenebenen',
    recent: 'Zuletzt',
    location: 'Mein Standort',
    settings: 'Einstellungen',
  },
  phone: { layers: 'Layer', recent: 'Zuletzt', location: 'Standort', settings: 'Einstellungen' },
};
const press = (page: Page, size: Size, fn: keyof (typeof NAMES)['desktop']) =>
  page.getByRole('button', { name: NAMES[size][fn], exact: true }).click();

/** A participant of its own per journey, size and repeat: preferences are personal and the data directory outlives a repeat. */
const who = (journey: string, size: Size): string =>
  `p-nav-${journey}-${size}-${test.info().repeatEachIndex}`;

async function mapBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('map').boundingBox();
  if (box === null) throw new Error('no map box');
  return box;
}

/** The crowd is at the map centre at the start view. */
async function tapCrowd(page: Page, clicks: 1 | 2): Promise<void> {
  const box = await mapBox(page);
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  if (clicks === 2) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
}

const zoomOf = async (page: Page): Promise<number> => (await readState(page))?.zoom ?? 0;

for (const [size, use] of [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', PIXEL],
] as const) {
  test.describe(size, () => {
    test.use({ ...use, locale: 'de-DE' });

    test.describe('cluster detail', () => {
      test('tap shows "n Objekte"; a row draws only its members; the row again or a map tap restores', async ({
        page,
        world,
      }) => {
        expect(world).toBe(true);
        await signInNav(page, who('cluster', size));
        await crowdSettled(page);
        const start = await readState(page);
        expect(start?.clusters).toBe(1);
        await tapCrowd(page, 1);
        const sheet = page.getByTestId('cluster-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.getByText(`${CROWD} Objekte`).first()).toBeVisible();
        const rows = sheet.getByTestId('cluster-row');
        await expect(rows).toHaveCount(2);
        // the big row: only its seven members are drawn, as singles, and the view is fitted to them
        await rows.filter({ hasText: `${SPLIT.big} Objekte` }).click();
        await expect.poll(async () => (await readState(page))?.singles, { timeout: 20_000 }).toBe(SPLIT.big);
        expect(await readState(page)).toMatchObject({ clusters: 0 });
        expect(await zoomOf(page)).toBeGreaterThan(START_ZOOM + 3);
        // the same row again ends the drill-down: everything is drawn, the view is back
        await rows.filter({ hasText: `${SPLIT.big} Objekte` }).click();
        await expect.poll(async () => (await readState(page))?.clusters, { timeout: 20_000 }).toBe(1);
        expect(await readState(page)).toMatchObject({ singles: start?.singles });
        expect(Math.abs((await zoomOf(page)) - START_ZOOM)).toBeLessThan(0.5);
        // the small row, then a tap on empty map: the sheet closes and everything is back
        await rows.filter({ hasText: '1 Objekt' }).click();
        await expect
          .poll(async () => (await readState(page))?.singles, { timeout: 20_000 })
          .toBe(SPLIT.small);
        const box = await mapBox(page);
        await page.mouse.click(box.x + 30, box.y + box.height * 0.3);
        await expect(sheet).toBeHidden();
        await expect.poll(async () => (await readState(page))?.clusters, { timeout: 20_000 }).toBe(1);
        expect(await readState(page)).toMatchObject({ singles: start?.singles });
      });

      test('a double tap on a cluster fits its members', async ({ page, world }) => {
        expect(world).toBe(true);
        await signInNav(page, who('cluster-dbl', size));
        await crowdSettled(page);
        await tapCrowd(page, 2);
        // v3 zoomed to the cluster's members (+page.svelte:1914): the view is fitted to them and the crowd falls
        // apart (into singles on a wide screen, into pairs on a phone, where even zoom 18 groups close markers)
        await expect.poll(() => zoomOf(page), { timeout: 20_000 }).toBeGreaterThan(START_ZOOM + 5);
        await expect
          .poll(async () => {
            const s = await readState(page);
            return (s?.clusters ?? 0) + (s?.singles ?? 0);
          })
          .toBeGreaterThan(2);
        await expect(page.getByTestId('cluster-sheet')).toBeHidden();
      });
    });

    test('Zuletzt: a row flies to at least RECENT_MIN_ZOOM and opens the feature', async ({
      page,
      world,
    }) => {
      expect(world).toBe(true);
      await signInNav(page, who('recent', size));
      await crowdSettled(page);
      expect(await zoomOf(page)).toBeLessThan(RECENT_MIN_ZOOM);
      if (size === 'phone') {
        // the bar has no Zuletzt: the second + opens it beside Neu (v3 BottomControlBar.svelte:54-57)
        await page.getByRole('button', { name: 'Neu', exact: true }).click();
        await page.getByRole('button', { name: 'Menü schließen', exact: true }).first().click();
      } else await press(page, size, 'recent');
      const recent = page.getByTestId('recent-sheet');
      await expect(recent).toBeVisible();
      await recent.getByTestId('recent-row').filter({ hasText: 'Baum' }).first().click();
      await expect.poll(() => zoomOf(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(RECENT_MIN_ZOOM);
      await expect(page.getByTestId('feature-sheet')).toBeVisible();
      await expect(page.getByTestId('map')).toHaveAttribute('data-selected', /./);
      // the crowd is on the map where it was: the flight ended near it
      const [lon, lat] = await centerOf(page);
      expect(Math.abs(lon - CENTER[0])).toBeLessThan(0.05);
      expect(Math.abs(lat - CENTER[1])).toBeLessThan(0.05);
      if (size === 'desktop') {
        // v3 `besideDetail`: Zuletzt stays open, left of the 450 px feature panel
        await expect(recent).toBeVisible();
        const [r, f] = await Promise.all([
          recent.boundingBox(),
          page.getByTestId('feature-sheet').boundingBox(),
        ]);
        expect(r && f && r.x + r.width <= f.x + 1).toBe(true);
      }
    });

    test.describe('Standort', () => {
      test.describe('granted', () => {
        test.use({ permissions: ['geolocation'], geolocation: HERE });
        test('centres the map on the position at zoom 15', async ({ page, world }) => {
          expect(world).toBe(true);
          await signInNav(page, who('standort', size));
          await press(page, size, 'location');
          await expect.poll(() => zoomOf(page), { timeout: 20_000 }).toBeCloseTo(POSITION_ZOOM, 1);
          await expect
            .poll(async () => {
              const [lon, lat] = await centerOf(page);
              return Math.hypot(lon - HERE.longitude, lat - HERE.latitude) < 0.002;
            })
            .toBe(true);
          await expect(page.getByText('Standort nicht verfügbar')).toBeHidden();
        });
      });

      test.describe('denied', () => {
        test.use({ permissions: [] });
        test('says "Standort nicht verfügbar" and leaves the map where it was', async ({ page, world }) => {
          expect(world).toBe(true);
          await signInNav(page, who('standort-denied', size));
          await crowdSettled(page);
          const before = await zoomOf(page);
          await press(page, size, 'location');
          await expect(page.getByText('Standort nicht verfügbar')).toBeVisible({ timeout: 20_000 });
          expect(await zoomOf(page)).toBeCloseTo(before, 1);
        });
      });
    });

    test('Layer sheet: the base radio and an overlay switch survive a reload', async ({ page, world }) => {
      expect(world).toBe(true);
      await page.route(/\/(tiles|wms)\//, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
      );
      await signInNav(page, who('layers', size));
      await press(page, size, 'layers');
      const sheet = page.getByRole('dialog', { name: 'Kartenlayer' });
      await expect(sheet.getByRole('radio', { name: BASES.first })).toBeChecked();
      await expect(sheet.getByRole('switch', { name: OVERLAY })).not.toBeChecked();
      await sheet.getByRole('radio', { name: BASES.second }).click();
      await sheet.getByRole('switch', { name: OVERLAY }).click();
      await expect(sheet.getByRole('radio', { name: BASES.second })).toBeChecked();
      await expect(sheet.getByRole('switch', { name: OVERLAY })).toBeChecked();
      await page.waitForLoadState('networkidle');
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      await press(page, size, 'layers');
      const again = page.getByRole('dialog', { name: 'Kartenlayer' });
      await expect(again.getByRole('radio', { name: BASES.second })).toBeChecked();
      await expect(again.getByRole('radio', { name: BASES.first })).not.toBeChecked();
      await expect(again.getByRole('switch', { name: OVERLAY })).toBeChecked();
    });

    test('language: switching in Optionen relabels the open feature sheet without a navigation', async ({
      page,
      world,
    }) => {
      expect(world).toBe(true);
      await signInNav(page, who('language', size));
      await crowdSettled(page);
      await page.getByRole('button', { name: 'Liste' }).click();
      const open = page.locator('table.ub-list tr', { hasText: 'Baum' }).locator('.ub-open').first();
      await expect(open).toBeVisible({ timeout: 30_000 });
      await open.click();
      if (size === 'desktop') await page.getByRole('button', { name: 'Liste' }).click();
      await expect(page.getByTestId('feature-sheet')).toBeVisible();
      await page.getByRole('tab', { name: 'Daten' }).click();
      const rows = page.getByTestId('daten-property');
      await expect(rows.filter({ hasText: 'Baumart' })).toBeVisible();
      // a marker on the document: a navigation or reload would drop it
      await page.evaluate(() => {
        (window as unknown as { __ub758: number }).__ub758 = 1;
      });
      // a phone's detail covers the bar (v3: the ModuleShell is above it): the header's account icon opens Einstellungen
      if (size === 'phone') await page.getByRole('button', { name: 'Konto' }).click();
      else await press(page, size, 'settings');
      await page.getByRole('tab', { name: 'Optionen' }).click();
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(rows.filter({ hasText: 'Species' })).toBeVisible();
      await expect(rows.filter({ hasText: 'Baumart' })).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __ub758?: number }).__ub758)).toBe(1);
    });
  });
}
