import { devices, expect, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { watchErrors } from './world';
import { REFUSAL_KEY, ROLE, signInAs, test } from './refused-world';

/**
 * WP-768: two tabs of one browser share the session cookie. A second sign-in turns it to another participant; the
 * first tab must neither send its queued run under the new person nor show the new person's data under the old name.
 * v3 kept one database per participant (`participant-state__<id>`) and showed the signed-in person only; the tab that
 * had the old person open went to its login page on the sign-in event (`+layout.svelte:300-312`).
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });

const RUNS = '**/api/p/refusalstadt/runs**';
const TASK = 'befund_ergaenzen';
const token = (who: string): string => rosterToken(E2E_DATA_DIR, REFUSAL_KEY, who, [ROLE]);

/** Accepted runs of `task` made by `actor`, as the server recorded them. */
function acceptedBy(actor: string): number {
  const db = openProjectDb(E2E_DATA_DIR, REFUSAL_KEY);
  try {
    return (
      db
        .prepare<{ n: number }>(
          "SELECT count(*) AS n FROM runs WHERE task = ? AND actor = ? AND outcome = 'accepted'",
        )
        .get(TASK, actor)?.n ?? 0
    );
  } finally {
    db.close();
  }
}

/** A finding the sending of which fails (the run endpoint is cut), so it waits in the queue of this device. */
async function queueFinding(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Liste' }).click();
  await page
    .getByRole('button', { name: /^Baum #/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Liste' }).click();
  await page.route(RUNS, (route) => route.abort());
  await page.getByRole('button', { name: 'Befund ergänzen' }).click();
  await page.getByLabel('Befund (Freitext)').fill('Pilz am Stamm');
  await page.getByRole('button', { name: 'Absenden' }).click();
  // WP-788: the form closes once the run is stored on the device; the feature sheet says so (v3 TaskRunNotices)
  await expect(page.getByTestId('run-pending')).toBeVisible();
  await expect(page.getByTestId('run-pending')).toContainText('Noch nicht übertragen');
}

/** Opens Einstellungen, Profil: the sheet that lists the runs queued on this device. */
async function openProfile(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Schließen' }).first();
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('tab', { name: 'Profil' }).click();
}

for (const size of ['phone', 'desktop'] as const) {
  test.describe(size, () => {
    if (size === 'desktop')
      test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
    for (const how of ['sign-in in a second tab', 'cookie turned without a message'] as const) {
      test(`${how}: the first tab never sends its run under the new person and keeps it for its owner`, async ({
        page,
        context,
        world,
      }, info) => {
        void world;
        const problems = watchErrors(page);
        const olga = `p-sw-a-${info.repeatEachIndex}-${info.retry}-${how.length}-${size}`;
        const felix = `p-sw-b-${info.repeatEachIndex}-${info.retry}-${how.length}-${size}`;
        await signInAs(page, olga);
        await queueFinding(page);

        if (how === 'sign-in in a second tab') {
          const second = await context.newPage();
          await second.goto(`/login?token=${encodeURIComponent(token(felix))}`);
          await expect(second).toHaveURL(/\/map$/);
        } else {
          const r = await context.request.post('/api/auth/exchange', { data: { token: token(felix) } });
          expect(r.status()).toBe(200);
        }
        // without a message the tab finds out at its next send: the server refuses it (409) and the tab moves to the new session
        const refused =
          how === 'cookie turned without a message'
            ? page.waitForResponse(
                (r) => r.url().includes('/api/p/refusalstadt/runs') && r.status() === 409,
                {
                  timeout: 60_000,
                },
              )
            : undefined;
        await page.unroute(RUNS);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await refused;
        // the first tab shows the new person: no queued run of the old one
        await page.waitForTimeout(2500);
        await openProfile(page);
        await expect(page.getByTestId('run-queue')).toHaveCount(0);
        expect(acceptedBy(olga)).toBe(0);
        expect(acceptedBy(felix)).toBe(0);

        // the old person signs in again: the run is still queued and now goes out as her own
        await page.goto(`/login?token=${encodeURIComponent(token(olga))}`);
        await expect(page).toHaveURL(/\/map$/);
        await expect.poll(() => acceptedBy(olga), { timeout: 30_000 }).toBe(1);
        expect(acceptedBy(felix)).toBe(0);
        expect(problems.filter((p) => !/Failed to load resource|ERR_FAILED/.test(p))).toEqual([]);
      });
    }

    test('two tabs of the same participant both keep syncing', async ({ page, context, world }, info) => {
      void world;
      const who = `p-sw-same-${size}-${info.repeatEachIndex}-${info.retry}`;
      await signInAs(page, who);
      const second = await context.newPage();
      await second.goto(`/login?token=${encodeURIComponent(token(who))}`);
      await expect(second).toHaveURL(/\/map$/);
      const calls: number[] = [];
      for (const p of [page, second])
        p.on('response', (r) => {
          if (r.url().includes('/api/p/refusalstadt/sync?')) calls.push(r.status());
        });
      for (const p of [page, second]) {
        await p.bringToFront();
        await p.evaluate(() => window.dispatchEvent(new Event('online')));
      }
      await page.waitForTimeout(2500);
      expect(calls.every((s) => s === 200)).toBe(true);
      await expect(page.getByTestId('map')).toBeVisible();
      await expect(second.getByTestId('map')).toBeVisible();
    });
  });
}
