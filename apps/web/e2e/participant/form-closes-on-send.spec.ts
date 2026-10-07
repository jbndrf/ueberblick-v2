import { devices, expect, type Page } from '@playwright/test';
import { watchErrors } from './world';
import { acceptedRuns, signInAs, test } from './refused-world';

/**
 * WP-788: the task form closes once the run is stored on the device, as in v3 (the v3 detail module
 * :754-756), even when the connection is up but the upload fails (a captive portal, a server error). The feature
 * sheet's run notice then says "Noch nicht übertragen" (v3 `TaskRunNotices.svelte`); once the upload works the run
 * is sent. Pixel 7 and Desktop Chrome 1280x800, de-DE.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });

const RUNS = '**/api/p/*/runs';
// the blocked upload is the point of the journey, so the browser's own report of it is expected
const BLOCKED = /Failed to load resource|503/;

async function openTree(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Liste' }).click();
  await page
    .getByRole('button', { name: /^Baum #/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Liste' }).click();
}

for (const size of ['phone', 'desktop'] as const) {
  test.describe(size, () => {
    if (size === 'desktop')
      test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
    let problems: string[] = [];
    test.beforeEach(({ page }) => {
      problems = watchErrors(page);
    });
    test.afterEach(() => {
      expect(problems.filter((p) => !BLOCKED.test(p))).toEqual([]);
    });

    test('uploads blocked: the form closes at once, the sheet says Noch nicht übertragen; unblocking sends the run', async ({
      page,
      world,
    }, info) => {
      expect(world.office).toBeDefined(); // the worker fixture seeds the project
      await signInAs(page, `p-close-${size}-${info.repeatEachIndex}-${info.retry}`);
      await openTree(page);
      const before = acceptedRuns('befund_ergaenzen');
      await page.route(RUNS, (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 503, body: 'blocked' })
          : route.fallback(),
      );
      await page.getByRole('button', { name: 'Befund ergänzen' }).click();
      await page.getByLabel('Befund (Freitext)').fill('Pilz am Stamm');
      await page.getByRole('button', { name: 'Absenden' }).click();
      // no "Auf diesem Gerät gespeichert. Wird jetzt gesendet." left standing in the sheet
      await expect(page.getByLabel('Befund (Freitext)')).toHaveCount(0);
      await expect(page.getByText('Wird jetzt gesendet.')).toHaveCount(0);
      await expect(page.getByTestId('run-pending')).toBeVisible();
      await expect(page.getByTestId('run-pending')).toContainText('Noch nicht übertragen');
      expect(acceptedRuns('befund_ergaenzen')).toBe(before);
      await page.unroute(RUNS);
      await expect.poll(() => acceptedRuns('befund_ergaenzen'), { timeout: 60_000 }).toBe(before + 1);
      await expect(page.getByTestId('run-pending')).toHaveCount(0);
    });
  });
}
