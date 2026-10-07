import { devices, expect, test } from '@playwright/test';
import { seedWorld, signIn } from './world';

/**
 * WP-734: online means the server answers (v3 pings /api/health every 5 s). With the browser online but the health
 * request failing, Einstellungen reads Offline and "Jetzt synchronisieren" is off; when the server answers it reads Online.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE', serviceWorkers: 'block' });
const SCREENS = [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

for (const [name, screen] of SCREENS) {
  test.describe(name, () => {
    test.use(screen);

    test('a failing health ping reads Offline and disables the sync button; recovery reads Online', async ({
      page,
    }) => {
      await signIn(page);
      await page.route('**/api/health', (route) => route.abort('failed'));
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      const sheet = page.getByRole('dialog', { name: 'Einstellungen' });
      await sheet.getByRole('tab', { name: 'Profil' }).click();
      await expect(sheet.getByText('Offline', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(sheet.getByRole('button', { name: 'Jetzt synchronisieren' })).toBeDisabled();
      await page.unroute('**/api/health');
      await expect(sheet.getByText('Online', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(sheet.getByRole('button', { name: 'Jetzt synchronisieren' })).toBeEnabled();
    });
  });
}
