import { devices, expect, test, type Page } from '@playwright/test';
import {
  CENTER,
  fieldToken,
  geometriesOfType,
  geometryOfLastRun,
  KEY,
  seedWorld,
  serverRuns,
  signIn,
  watchErrors,
} from './world';

/**
 * WP-711: the Liste shows every feature in the map view. Twelve trees lie around the start view; the Liste lists all of
 * them after the first fit and after zooming out, on the Pixel 7 profile where the hidden map used to empty the list.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
const SIZES = [
  ['phone', { viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;

const SEEDED = 12;

test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await ctx.post('/api/auth/exchange', { data: { token: fieldToken() } });
  for (let i = 0; i < SEEDED; i++) {
    const nr = String(i + 1).padStart(2, '0');
    const r = await ctx.post(`/api/p/${KEY}/runs`, {
      data: {
        id: `00000000-0000-7000-8000-0000000007${nr}`,
        task: 'erfassen',
        configVersion: 1,
        input: {
          geometrie: {
            type: 'Point',
            coordinates: [CENTER[0] + ((i % 4) - 1.5) * 0.002, CENTER[1] + (Math.floor(i / 4) - 1) * 0.002],
          },
          vitalitaet: 'v2',
        },
      },
    });
    expect(r.status(), await r.text()).toBe(200);
  }
  await ctx.dispose();
});

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = watchErrors(page);
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

/** The trees in the Liste (the 12 seeded ones plus what the shared world already holds). */
async function trees(page: Page): Promise<number> {
  return page.locator('table.ub-list .ub-open', { hasText: /^\s*Baum/ }).count();
}

test('after the first fit the Liste lists every tree of the view', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect.poll(() => trees(page)).toBeGreaterThanOrEqual(SEEDED);
});

test('zoomed out the Liste still lists every tree, and a hidden map does not empty it', async ({ page }) => {
  await signIn(page);
  const box = await page.getByTestId('map').boundingBox();
  if (box === null) throw new Error('no map box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await expect(page.getByTestId('map')).toHaveAttribute('data-idle', 'true');
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect.poll(() => trees(page)).toBeGreaterThanOrEqual(SEEDED);
  const shown = await trees(page);
  // the map is hidden while the Liste is open; it stays as long as the person looks at it
  await page.waitForTimeout(800);
  expect(await trees(page)).toBe(shown);
});

/** WP-790: at both sizes, the last row of the Liste ends above the phone bottom bar (desktop has none). */
for (const [size, device] of SIZES) {
  test.describe(`end of the Liste (${size})`, () => {
    test.use(device);
    test('the last row is fully visible above the bottom bar after scrolling to the end', async ({
      page,
    }) => {
      await signIn(page);
      await page.getByRole('button', { name: 'Liste' }).click();
      await expect.poll(() => trees(page)).toBeGreaterThanOrEqual(SEEDED);
      const last = page.locator('table.ub-list tbody tr').last();
      await last.scrollIntoViewIfNeeded();
      // scroll the Liste's own container to its end
      await page
        .locator('table.ub-list')
        .last()
        .evaluate((t) => {
          for (let e: HTMLElement | null = t.parentElement; e; e = e.parentElement) {
            if (e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY === 'auto')
              e.scrollTop = e.scrollHeight;
          }
        });
      const box = await last.boundingBox();
      if (box === null) throw new Error('no row box');
      const bar = page.getByRole('navigation', { name: 'Kartenleiste' });
      const limit = (await bar.isVisible())
        ? ((await bar.boundingBox())?.y ?? 0)
        : (page.viewportSize()?.height ?? 0);
      expect(box.y + box.height).toBeLessThanOrEqual(limit + 0.5);
    });
  });
}

/** WP-783: a map task started from a Liste row closes the Liste and places on the map, at both sizes. */
for (const [size, device] of SIZES) {
  test.describe(`map task from a Liste row (${size})`, () => {
    test.use(device);
    test('"Baum verschieben" from a Liste row shows the pin and the server stores the new position', async ({
      page,
    }) => {
      await signIn(page);
      await page.getByRole('button', { name: 'Liste' }).click();
      await page
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      const before = serverRuns('verschieben');
      const old = geometriesOfType('baum');
      await page.getByRole('button', { name: 'Baum verschieben' }).click(); // the Liste is still open
      await expect(page.getByText('Noch keine Form')).toHaveCount(0);
      await expect(page.getByTestId('placement-confirm')).toBeVisible();
      await expect(page.getByTestId('map')).toBeVisible();
      const box = await page.getByTestId('map').boundingBox();
      if (box === null) throw new Error('no map box');
      await page.mouse.click(box.x + box.width / 4, box.y + box.height / 3);
      await page.getByTestId('placement-confirm').click();
      await expect.poll(() => serverRuns('verschieben'), { timeout: 20_000 }).toBe(before + 1);
      const moved = geometryOfLastRun('verschieben');
      if (moved === undefined) throw new Error('the run wrote no geometry');
      const was = old[moved.featureId]?.coordinates as [number, number] | undefined;
      expect(moved.geometry.type).toBe('Point');
      expect(moved.geometry.coordinates).not.toEqual(was);
    });
  });
}
