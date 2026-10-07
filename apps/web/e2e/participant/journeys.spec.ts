import { devices, expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { RECENT_MIN_ZOOM } from '../../src/lib/participant/sheets/recent/fly';
import { rosterToken } from '../seed';
import {
  allowErrors,
  geometriesOfType,
  geometryOfLastRun,
  KEY,
  seedWorld,
  serverRuns,
  signIn,
  watchErrors,
} from './world';

/**
 * WP-703: the participant's v3 journeys on the built app (real security headers, Pixel 7, de-DE, touch). Every test
 * fails on a console error, a page error or a CSP violation. The photo journey is `submit-photo.spec.ts`.
 */
/** The zoom of the map, from the longitude span the map reports (512 px tiles): the e2e reads it instead of the canvas. */
async function mapZoom(page: Page): Promise<number> {
  const map = page.getByTestId('map');
  const span = Number(await map.getAttribute('data-span'));
  const box = await map.boundingBox();
  if (box === null || !(span > 0)) return 0;
  return Math.log2((360 * box.width) / (512 * span));
}
/** The zoom a single feature is focused at (Zuletzt fly-to, `RECENT_MIN_ZOOM`). */
const FEATURE_ZOOM = RECENT_MIN_ZOOM;

test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
const SCREENS = [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = watchErrors(page);
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

for (const [name, screen] of SCREENS) {
  test.describe(name, () => {
    test.use(screen);
    test('sign in by link lands on the map', async ({ page }) => {
      await signIn(page);
      // phone: the bottom bar (v3 map/components/BottomControlBar.svelte:68, md:hidden); desktop: the same functions as icons in the header (v3 (participant)/+layout.svelte:566-647)
      if (name === 'phone')
        await expect(page.getByRole('navigation', { name: 'Kartenleiste' })).toBeVisible();
      else {
        await expect(page.getByRole('navigation', { name: 'Kartenleiste' })).toBeHidden();
        await expect(page.locator('header').getByRole('button', { name: 'Filter' })).toBeVisible();
      }
      await expect(page.getByText(KEY).first()).toBeVisible();
    });

    test('open a tree, run "Bearbeiten" and move it with a tap inside the area', async ({ page }) => {
      await signIn(page);
      // the list is the way to a feature without tapping a cluster; the map must be on to place the pin
      await page.getByRole('button', { name: 'Liste' }).click();
      await page
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      await page.getByRole('button', { name: 'Liste' }).click();
      const before = serverRuns('baum_bearbeiten');
      await page.getByRole('button', { name: 'Bearbeiten' }).click();
      // WP-730 (B-023): no question on the tap; the task asks "Änderungen speichern?" at Absenden
      await expect(page.getByText('Änderungen speichern?')).toHaveCount(0);
      await page.getByRole('button', { name: 'Weiter' }).click();
      // the location step of an existing tree opens on the tree at street level (v3 `LocationEditTool` starts at its position)
      await expect.poll(() => mapZoom(page)).toBeGreaterThanOrEqual(FEATURE_ZOOM - 0.05);
      // the pin sits at the map centre, inside the area; tapping next to it moves it, it must not open the area
      const box = await page.getByTestId('map').boundingBox();
      if (box === null) throw new Error('no map box');
      await page.mouse.click(box.x + box.width / 2 + 12, box.y + box.height / 2 + 18);
      await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Stadtpark' })).toHaveCount(0);
      await expect(page.getByText('Noch kein Standort gewählt')).toHaveCount(0);
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect(page.getByText('Änderungen speichern?')).toBeVisible();
      expect(serverRuns('baum_bearbeiten')).toBe(before); // nothing is sent before the question is answered
      await page.getByRole('button', { name: 'Fortfahren' }).click();
      await expect.poll(() => serverRuns('baum_bearbeiten'), { timeout: 20_000 }).toBe(before + 1);
    });

    test('"Baum verschieben" (draw tool on a point) places the pin on the map and the server has the new position', async ({
      page,
    }, testInfo) => {
      await signIn(page);
      await page.getByRole('button', { name: 'Liste' }).click();
      await page
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      await page.getByRole('button', { name: 'Liste' }).click();
      const before = serverRuns('verschieben');
      const oldGeometry = geometriesOfType('baum');
      await page.getByRole('button', { name: 'Baum verschieben' }).click();
      // the pin, not a sheet that says the shape is drawn on the map
      await expect(page.getByText('Noch keine Form')).toHaveCount(0);
      await expect(page.getByTestId('placement-confirm')).toBeVisible();
      const box = await page.getByTestId('map').boundingBox();
      if (box === null) throw new Error('no map box');
      await page.mouse.click(
        box.x + box.width / 2 + 30 + 10 * testInfo.repeatEachIndex,
        box.y + box.height / 2 + 18,
      );
      await page.getByTestId('placement-confirm').click();
      await expect.poll(() => serverRuns('verschieben'), { timeout: 20_000 }).toBe(before + 1);
      // the map opens on the tree (WP-730): the stored point moved to the tapped place, east and south of the old one
      const moved = geometryOfLastRun('verschieben');
      if (moved === undefined) throw new Error('the run wrote no geometry');
      expect(moved.geometry.type).toBe('Point');
      const [lon, lat] = moved.geometry.coordinates as [number, number];
      const old = oldGeometry[moved.featureId]?.coordinates as [number, number] | undefined;
      if (old === undefined) throw new Error('the tree had no stored point');
      expect(lon).toBeGreaterThan(old[0]);
      expect(lon - old[0]).toBeLessThan(0.1);
      expect(lat).toBeLessThan(old[1]);
      expect(old[1] - lat).toBeLessThan(0.1);
    });

    test('Neu: an area is drawn with three taps (the first tap does not close the slot) and the run is sent', async ({
      page,
    }) => {
      const token = rosterToken(E2E_DATA_DIR, KEY, 'p-office', ['verwaltung']);
      await page.goto(`/login?token=${encodeURIComponent(token)}`);
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      const before = serverRuns('flaeche_anlegen');
      await page.getByRole('button', { name: 'Neu' }).first().click();
      await page.getByTestId('create-pill').filter({ hasText: 'Fläche' }).first().click();
      const toolbar = page.getByTestId('draw-toolbar');
      await expect(toolbar).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Kartenleiste' })).toBeHidden(); // placing hides the bar (v3)
      const box = await page.getByTestId('map').boundingBox();
      if (box === null) throw new Error('no map box');
      // drawn well away from the map centre, so the new area never clusters with the seed area the other journeys tap
      const cx = box.x + box.width * 0.2;
      const cy = box.y + box.height * 0.65;
      for (const [dx, dy] of [
        [-60, 60],
        [60, 60],
        [0, -60],
      ] as const) {
        await page.mouse.click(cx + dx, cy + dy);
        await expect(toolbar).toBeVisible(); // a tap draws; it does not end the drawing mode
      }
      // the controls sit below the header, not over the account button
      const bar = await toolbar.boundingBox();
      const head = await page.locator('header').boundingBox();
      if (bar === null || head === null) throw new Error('no boxes');
      expect(bar.y).toBeGreaterThanOrEqual(head.y + head.height);
      await page.getByTestId('draw-finish').click();
      await page.getByLabel('Name').fill('Neuer Park');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => serverRuns('flaeche_anlegen'), { timeout: 20_000 }).toBe(before + 1);
      // the stored geometry is the drawn area: a closed ring of three distinct vertices
      const drawn = geometryOfLastRun('flaeche_anlegen');
      if (drawn === undefined) throw new Error('the run wrote no geometry');
      expect(drawn.geometry.type).toBe('Polygon');
      const ring = (drawn.geometry.coordinates as number[][][])[0] ?? [];
      expect(ring).toHaveLength(4);
      expect(ring[3]).toEqual(ring[0]);
      expect(new Set(ring.slice(0, 3).map((c) => c.join(','))).size).toBe(3);
    });

    test('"Bearbeiten": the map closed without moving keeps the location, and the question comes at Absenden', async ({
      page,
    }) => {
      await signIn(page);
      await page.getByRole('button', { name: 'Liste' }).click();
      await page
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      await page.getByRole('button', { name: 'Liste' }).click();
      const before = serverRuns('baum_bearbeiten');
      await page.getByRole('button', { name: 'Bearbeiten' }).click();
      await page.getByRole('button', { name: 'Weiter' }).click();
      await page.getByTestId('placement-cancel').click();
      await expect(page.getByText('Standort gewählt')).toBeVisible();
      await expect(page.getByText('Noch kein Standort gewählt')).toHaveCount(0);
      await page.getByRole('button', { name: 'Absenden' }).click();
      await page.getByRole('button', { name: 'Abbrechen' }).click(); // the question: no run is sent
      expect(serverRuns('baum_bearbeiten')).toBe(before);
    });

    test('Filter: the switch of a type goes off and on', async ({ page }) => {
      await signIn(page);
      await page.getByRole('button', { name: 'Filter' }).click();
      const sheet = page.getByRole('dialog', { name: 'Karteninhalt' });
      await sheet.getByRole('switch', { name: 'Baum' }).click();
      await expect(sheet.getByRole('switch', { name: 'Baum' })).not.toBeChecked();
      await sheet.getByRole('switch', { name: 'Baum' }).click();
      await expect(sheet.getByRole('switch', { name: 'Baum' })).toBeChecked();
    });

    // WP-706: a removal and a batch or re-add drop the cluster index, so count and detail are exact after every switch.
    test('Filter: switching a type off hides it from the map, on brings it back', async ({ page }) => {
      await signIn(page);
      // the tree and the area are one cluster at the start view; a tap on the map centre opens its detail
      const box = await page.getByTestId('map').boundingBox();
      if (box === null) throw new Error('no map box');
      const tapCentre = async (): Promise<void> => {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      };
      await tapCentre();
      // the world is shared and grows (the offline journey reports a tree), so the count is read, not assumed
      const cluster = page.getByRole('dialog', { name: /^\d+ Objekte/ });
      await expect(cluster).toBeVisible();
      const clusterName = (await cluster.getAttribute('aria-label')) ?? '';
      expect(clusterName).toMatch(/^\d+ Objekte/);
      await page.getByRole('button', { name: 'Schließen' }).click();
      await page.getByRole('button', { name: 'Filter' }).click();
      const sheet = page.getByRole('dialog', { name: 'Karteninhalt' });
      await sheet.getByRole('switch', { name: 'Baum' }).click();
      await expect(sheet.getByRole('switch', { name: 'Baum' })).not.toBeChecked();
      await sheet.getByRole('button', { name: /^(Close|Schließen)$/ }).click();
      // only the area is left: its own sheet opens
      await tapCentre();
      await expect(page.getByRole('dialog', { name: 'Stadtpark' })).toBeVisible();
      await page.getByRole('button', { name: 'Schließen' }).click();
      await page.getByRole('button', { name: 'Filter' }).click();
      await sheet.getByRole('switch', { name: 'Baum' }).click();
      await expect(sheet.getByRole('switch', { name: 'Baum' })).toBeChecked();
      await sheet.getByRole('button', { name: /^(Close|Schließen)$/ }).click();
      await tapCentre();
      await expect(page.getByRole('dialog', { name: clusterName })).toBeVisible();
    });

    test('Einstellungen: theme, font size and language survive a reload', async ({ page }, info) => {
      await signIn(page, `p-settings-${name}-${info.repeatEachIndex}-${info.retry}`); // the preferences follow the person: this one is for this test only
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      const sheet = page.getByRole('dialog', { name: 'Einstellungen' });
      await sheet.getByRole('tab', { name: 'Optionen' }).click();
      await sheet.getByRole('button', { name: 'Dunkel' }).click();
      await sheet.getByRole('button', { name: 'XL', exact: true }).click();
      await sheet.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await page.getByRole('button', { name: 'Settings' }).click();
      const again = page.getByRole('dialog', { name: 'Settings' });
      await again.getByRole('tab', { name: 'Options' }).click();
      await expect(again.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
      await expect(again.getByRole('button', { name: 'XL', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(again.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    test('offline: the app starts, a report is queued and sent when back online', async ({
      page,
      context,
    }) => {
      await signIn(page);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 30_000,
      });
      await context.setOffline(true);
      // the sync worker logs its failed connection while offline as a console error (reported to lead-b); only in this phase
      allowErrors(problems, /participant sync:open: .*Failed to fetch|net::ERR_INTERNET_DISCONNECTED/);
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      const before = serverRuns('erfassen');
      await page.getByRole('button', { name: 'Neu' }).first().click();
      await page.getByTestId('create-pill').first().click();
      await page.getByTestId('placement-confirm').click();
      await page.getByLabel('Vitalität (Stufe)').click();
      await page.getByText('2', { exact: true }).last().click();
      await page.getByRole('button', { name: 'Absenden' }).click();
      // the new object's sheet shows the run as not yet transferred (it is on the device queue); the server has not seen it
      await expect(page.getByTestId('run-pending')).toBeVisible();
      await expect(page.getByTestId('run-pending')).toContainText('Noch nicht übertragen');
      expect(serverRuns('erfassen')).toBe(before);
      await context.setOffline(false);
      await expect.poll(() => serverRuns('erfassen'), { timeout: 30_000 }).toBe(before + 1);
    });
  });
}
