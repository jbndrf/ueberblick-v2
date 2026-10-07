import { devices, expect, test, type Page } from '@playwright/test';
import { CENTER, fieldToken, KEY, seedWorld, signIn, watchErrors } from './world';

/**
 * WP-862: a Liste with more rows than one batch draws rows as the person scrolls; the last feature stays reachable and
 * opens, and Tab walks on past the first batch. Phone and desktop.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
const SIZES = [
  ['phone', { viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;
const MANY = 130; // more than one batch (100)

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(120_000);
  await seedWorld(playwright, baseURL ?? '');
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await ctx.post('/api/auth/exchange', { data: { token: fieldToken() } });
  for (let i = 0; i < MANY; i++) {
    const r = await ctx.post(`/api/p/${KEY}/runs`, {
      data: {
        id: `00000000-0000-7000-8000-000000009${String(i).padStart(3, '0')}`,
        task: 'erfassen',
        configVersion: 1,
        input: {
          geometrie: {
            type: 'Point',
            coordinates: [CENTER[0] + ((i % 13) - 6) * 0.0005, CENTER[1] + (Math.floor(i / 13) - 5) * 0.0005],
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

const BATCH = 100;
const total = async (page: Page): Promise<number> =>
  Number(await page.locator('table.ub-list').first().getAttribute('aria-rowcount')) - 1;
/** Opens the Liste once every seeded tree has arrived and the first batch is drawn. */
async function openLongListe(page: Page): Promise<void> {
  await signIn(page);
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect.poll(() => rowsOf(page).count(), { timeout: 30_000 }).toBe(BATCH);
  await expect.poll(() => total(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(MANY);
}
const rowsOf = (page: Page) => page.locator('table.ub-list').first().locator('tbody tr.ub-row');

for (const [size, device] of SIZES) {
  test.describe(`long Liste (${size})`, () => {
    test.use(device);

    test('draws the first batch, then more rows as the person scrolls to the end; the last row opens', async ({
      page,
    }) => {
      await openLongListe(page);
      expect(await rowsOf(page).count()).toBe(BATCH);
      await expect(async () => {
        await rowsOf(page).last().scrollIntoViewIfNeeded();
        expect(await rowsOf(page).count()).toBe(await total(page));
      }).toPass({ timeout: 20_000 });
      const last = rowsOf(page).last();
      await last.scrollIntoViewIfNeeded();
      await last.getByRole('button').click();
      await expect(page.getByRole('button', { name: 'Baum verschieben' })).toBeVisible();
    });

    test('Tab reaches rows past the first batch', async ({ page }) => {
      await openLongListe(page);
      await rowsOf(page)
        .nth(BATCH - 1)
        .getByRole('button')
        .focus();
      await page.keyboard.press('Tab');
      await expect.poll(() => rowsOf(page).count()).toBeGreaterThan(BATCH);
      const index = await page.evaluate(() =>
        document.activeElement?.closest('tr')?.getAttribute('aria-rowindex'),
      );
      expect(index).toBe(String(BATCH + 2)); // the row after the 100th (the header is row 1)
    });
  });
}
