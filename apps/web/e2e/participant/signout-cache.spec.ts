import { devices, expect, test, type Page } from '@playwright/test';
import { seedWorld, signIn } from './world';

/**
 * WP-853 (QA hunt 10): Abmelden must not leave a redirected /login page cached under /map. Signed out, /map shows the
 * sign-in page every time; after a new sign-in the app starts offline again (WP-717).
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

const controlled = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });

const signOut = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('tab', { name: 'Profil' }).click();
  await page.getByRole('button', { name: 'Abmelden' }).click();
  const confirm = page.getByRole('alertdialog');
  if (await confirm.isVisible().catch(() => false))
    await confirm.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login/);
};

for (const size of ['phone', 'desktop'] as const) {
  test.describe(size, () => {
    if (size === 'desktop')
      test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
    test('after Abmelden /map shows the sign-in page twice; a new sign-in starts offline again', async ({
      page,
      context,
    }) => {
      await signIn(page);
      await controlled(page);
      await signOut(page);
      for (let i = 0; i < 2; i += 1) {
        await page.goto('/map');
        await expect(page).toHaveURL(/\/login/);
      }
      await signIn(page);
      await controlled(page);
      // the background refresh stores the good page
      await expect
        .poll(() =>
          page.evaluate(async () => {
            for (const k of await caches.keys()) {
              const r = await (await caches.open(k)).match('/map');
              if (r) return r.redirected;
            }
            return undefined;
          }),
        )
        .toBe(false);
      await page.goto('/map');
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
    });

    test('signed out and offline, / and /map show the sign-in page with its offline message (WP-866)', async ({
      page,
      context,
    }) => {
      await signIn(page);
      await controlled(page);
      await signOut(page);
      await context.setOffline(true);
      for (const path of ['/map', '/']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login/);
        await expect(page.getByRole('heading', { name: 'Anmeldung für Teilnehmende' })).toBeVisible();
        await expect(page.getByText('Die App konnte nicht geladen werden')).toHaveCount(0);
      }
      // the offline message is the sign-in's answer to a try (v3 and v4 alike)
      await page.getByRole('textbox', { name: 'Zugangstoken' }).fill('abc');
      await page.getByRole('button', { name: 'Anmelden' }).click();
      await expect(page.getByText('Keine Verbindung. Zum Anmelden ist einmalig Netz nötig.')).toBeVisible();
    });
  });
}
