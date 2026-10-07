import { devices, expect, test, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { axeViolations } from '../../../../e2e/a11y/axe';
import { rosterToken } from '../seed';
import { KEY, seedWorld, signIn, watchErrors } from './world';

/**
 * WP-855: the history chip ("n Änderungen") reads at 4.5:1 in Daten, and the Liste on a phone keeps words whole and
 * scrolls inside its own region instead of the page.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
  // one tree with two controls, so its Vitalität has a history
  const field = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await field.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, KEY, 'p-field-855', ['kontrolle']) },
  });
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  const tree = db.prepare<{ id: string }>("SELECT id FROM features WHERE type = 'baum' LIMIT 1").get();
  db.close();
  for (const [n, vit] of [
    ['1', 'v1'],
    ['2', 'v0'],
  ] as const) {
    const r = await field.post(`/api/p/${KEY}/runs`, {
      data: {
        id: `00000000-0000-7000-8000-00000000085${n}`,
        task: 'kontrolle',
        configVersion: 1,
        featureId: tree?.id,
        input: { vitalitaet: vit, befund: `Befund ${n}` },
      },
    });
    expect(r.status(), await r.text()).toBe(200);
  }
  await field.dispose();
});

test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
for (const [name, screen] of [
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const) {
  test.describe(name, () => {
    // the axe helper injects an inline script, which the app's CSP refuses
    test.use({ ...screen, bypassCSP: true });
    let problems: string[] = [];
    test.beforeEach(({ page }) => {
      problems = watchErrors(page);
    });
    test.afterEach(() => {
      expect(problems).toEqual([]);
    });

    async function openListe(page: Page): Promise<void> {
      await signIn(page);
      const toggle = page.getByRole('button', { name: 'Liste', exact: true });
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
      await expect(page.getByRole('table').first()).toBeVisible();
    }

    test('the history chip has no colour-contrast violation in Daten', async ({ page }) => {
      await openListe(page);
      await page
        .getByRole('table', { name: /^Baum/ })
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      await page.getByRole('tab', { name: 'Daten' }).click();
      const chip = page.locator('.history-toggle').first();
      await expect(chip).toBeVisible();
      const violations = await axeViolations(page, { scope: chip });
      expect(violations.filter((v) => v.includes('color-contrast'))).toEqual([]);
    });

    test('the Liste keeps words whole and the page does not scroll sideways', async ({ page }) => {
      await openListe(page);
      const result = await page.evaluate(() => {
        const split: string[] = [];
        for (const cell of document.querySelectorAll('table.ub-list td, table.ub-list th')) {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
            for (const m of (n.textContent ?? '').matchAll(/\S+/g)) {
              const range = document.createRange();
              range.setStart(n, m.index);
              range.setEnd(n, m.index + m[0].length);
              if (range.getClientRects().length > 1) split.push(m[0]);
            }
          }
        }
        return { split, scrolls: document.documentElement.scrollWidth > window.innerWidth };
      });
      expect(result.split).toEqual([]);
      expect(result.scrolls).toBe(false);
    });
  });
}
