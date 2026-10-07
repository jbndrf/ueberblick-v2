import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { openControlDb, openProjectDb, setSelfJoin } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../playwright.config';

/**
 * WP-639: the public self-join link `/join/<slug>` in a real browser, at phone size (390x844) and desktop size
 * (1280x800). Opening it without scripts (a link preview) creates nothing; with scripts the guest is created and
 * signed in at once, and the second visit of the same device creates no second guest.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const KEY = 'joinstadt';
const SLUG = 'maengel-joinstadt';

const guests = (): number => {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    return db.prepare<{ n: number }>('SELECT count(*) AS n FROM participants').get()?.n ?? -1;
  } finally {
    db.close();
  }
};

test.beforeAll(() => {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', 'create-project', KEY, KEY], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR },
  });
  expect(r.status).toBe(0);
  const control = openControlDb(`${E2E_DATA_DIR}/control.db`);
  const row = control.prepare<{ id: string }>('SELECT id FROM projects WHERE key = ?').get(KEY);
  expect(
    setSelfJoin({ control, now: () => new Date() }, row?.id ?? '', 'melder', { enabled: true, slug: SLUG })
      .ok,
  ).toBe(true);
  control.close();
});

const SIZES = [
  { name: 'phone 390x844', viewport: { width: 390, height: 844 } },
  { name: 'desktop 1280x800', viewport: { width: 1280, height: 800 } },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport });

    test('without scripts the link only offers the button and creates nothing', async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({ viewport: size.viewport, javaScriptEnabled: false });
      const page = await context.newPage();
      const before = guests();
      await page.goto(`${baseURL}/join/${SLUG}`);
      const button = page.getByTestId('join-form').getByRole('button');
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= size.viewport.width).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(guests()).toBe(before);
      await context.close();
    });

    test('with scripts the guest is created, signed in and lands on the map; a second visit adds none', async ({
      page,
    }) => {
      const before = guests();
      await page.goto(`/join/${SLUG}`);
      await page.getByTestId('join-name').fill('Erika Muster');
      await page.getByTestId('join-form').getByRole('button').click();
      await page.waitForURL(/\/map$/, { waitUntil: 'commit' });
      expect(guests()).toBe(before + 1);
      await page.goto(`/join/${SLUG}`);
      await page.waitForURL(/\/map$/, { waitUntil: 'commit' });
      expect(guests()).toBe(before + 1);
    });

    test('an unknown link is "Not found"', async ({ page }) => {
      const res = await page.goto('/join/gibt-es-nicht');
      expect(res?.status()).toBe(404);
    });
  });
}
