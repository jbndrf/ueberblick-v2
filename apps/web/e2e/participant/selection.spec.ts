import { devices, expect, test, type Page } from '@playwright/test';
import { seedWorld, signIn, watchErrors } from './world';

/**
 * WP-733: the map marks the feature whose sheet is open (v3 `MapCanvas.svelte:980-993`) and shows a pointer over a
 * feature (`MapCanvas.svelte:1085-1090`). The map element carries the marked id as `data-selected` (the renderer's
 * highlight layers are canvas pixels), and the canvas carries the cursor. Desktop: a mouse can hover; the phone browser still dispatches mouse moves (a paired mouse, or the emulation), and v3's handler is the same on both sizes.
 */
const { defaultBrowserType: _unused, ...PIXEL } = devices['Pixel 7'];
void _unused;
const SIZES = [
  ['phone', PIXEL],
  ['desktop', { viewport: { width: 1280, height: 800 } }],
] as const;
for (const [size, screen] of SIZES) {
  test.describe(size, () => {
    test.use({ ...screen, locale: 'de-DE' });
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

    const map = (page: Page) => page.getByTestId('map');
    const rows = (page: Page) => page.locator('table.ub-list .ub-open');

    test('the open feature is marked, the mark moves to the next feature and goes when the sheet closes', async ({
      page,
    }) => {
      await signIn(page);
      await expect(map(page)).not.toHaveAttribute('data-selected', /./);
      await page.getByRole('button', { name: 'Liste' }).click();
      await expect.poll(() => rows(page).count()).toBeGreaterThanOrEqual(2);
      await rows(page).first().click();
      await page.getByRole('button', { name: 'Liste' }).click();
      await expect(page.getByTestId('feature-sheet')).toBeVisible();
      const first = await map(page).getAttribute('data-selected');
      expect(first).toBeTruthy();
      // WP-740: the real map's highlight layer filters on that id (data-selected alone never proved the renderer got it)
      await expect(map(page)).toHaveAttribute('data-select-filter', new RegExp(`"${first ?? ''}"`));
      // another feature opens (the Liste is one way; a relation path or Zuletzt call the same function): the mark moves
      await page.getByRole('button', { name: 'Liste' }).click();
      await rows(page).last().click();
      await page.getByRole('button', { name: 'Liste' }).click();
      await expect(map(page)).not.toHaveAttribute('data-selected', first ?? '');
      await expect(map(page)).toHaveAttribute('data-selected', /./);
      await expect(map(page)).not.toHaveAttribute('data-select-filter', new RegExp(`"${first ?? ''}"`));
      await expect(map(page)).toHaveAttribute('data-select-filter', /"id"\],"[^"]+"/);
      await page.getByRole('button', { name: 'Schließen' }).click();
      await expect(page.getByTestId('feature-sheet')).toBeHidden();
      await expect(map(page)).not.toHaveAttribute('data-selected', /./);
      await expect(map(page)).toHaveAttribute('data-select-filter', /"id"\],""\]/);
    });

    test('the cursor is a pointer over a feature and the default again beside it', async ({ page }) => {
      await signIn(page);
      const box = await map(page).boundingBox();
      if (box === null) throw new Error('no map box');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await expect(map(page)).toHaveAttribute('data-idle', 'true');
      const cursor = (): Promise<string> =>
        page.locator('canvas.maplibregl-canvas').evaluate((c) => (c as HTMLElement).style.cursor);
      // the start view fits the features: walk the middle of the map until the pointer is over one
      let found: [number, number] | undefined;
      for (let dy = -150; dy <= 150 && found === undefined; dy += 20) {
        for (let dx = -250; dx <= 250 && found === undefined; dx += 20) {
          await page.mouse.move(cx + dx, cy + dy);
          if ((await cursor()) === 'pointer') found = [cx + dx, cy + dy];
        }
      }
      expect(found, 'no feature under the mouse in the middle of the map').toBeDefined();
      await page.mouse.move(box.x + 4, box.y + box.height - 4);
      await expect.poll(cursor).not.toBe('pointer');
    });
  });
}
