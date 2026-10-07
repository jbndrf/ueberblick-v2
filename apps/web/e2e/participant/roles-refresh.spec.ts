import { devices, expect, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { watchErrors } from './world';
import { REFUSAL_KEY, setRoles, test } from './refused-world';

/**
 * WP-784, in place since WP-796: an admin takes a role away; "Jetzt synchronisieren" shows the role gone in Einstellungen Profil and the
 * role's task is no longer offered, without a reload. v3 re-read the participant record on sync
 * (`reference/src/lib/participant-state/`). Pixel 7 and Desktop Chrome 1280x800, de-DE.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });

async function signInWith(page: Page, participant: string, roles: string[]): Promise<void> {
  const token = rosterToken(E2E_DATA_DIR, REFUSAL_KEY, participant, roles);
  await page.goto(`/login?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
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
      expect(problems).toEqual([]);
    });

    test('a role removed by the admin is gone from Profil after Jetzt synchronisieren, and its task is not offered', async ({
      page,
      world,
    }, info) => {
      const who = `p-roles-${size}-${info.repeatEachIndex}-${info.retry}`;
      await signInWith(page, who, ['kontrolle', 'verwaltung']);
      await page.getByRole('button', { name: 'Liste' }).click();
      await page
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      await expect(page.getByRole('button', { name: 'Befund ergänzen' })).toBeVisible();
      await page.getByRole('button', { name: 'Schließen' }).first().click();

      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('tab', { name: 'Profil' }).click();
      const roles = page.getByTestId('roles-card');
      await expect(roles).toBeVisible();
      await expect(roles).toContainText('Baumkontrolle');

      await setRoles(world, who, ['verwaltung']);
      await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click();
      // the roles are applied in place (WP-796, as v3's live roles collection): the sheet stays open, the card updates
      await expect(page.getByTestId('roles-card')).not.toContainText('Baumkontrolle', { timeout: 20_000 });
      await expect(page.getByRole('dialog', { name: 'Einstellungen' })).toBeVisible();
      await expect(page.getByTestId('roles-card')).toBeVisible();
      await expect(page.getByTestId('roles-card')).toContainText('Verwaltung');
      await page.getByRole('button', { name: 'Schließen' }).first().click();
      // the list stays open (nothing remounted): its first Objekt opens, and the role's task is no longer offered
      await page
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      await expect(page.getByRole('button', { name: 'Befund ergänzen' })).toHaveCount(0);
    });

    test('a role removed by the admin shows after an automatic sync, without Jetzt synchronisieren (WP-793)', async ({
      page,
      world,
    }, info) => {
      const who = `p-roles-auto-${size}-${info.repeatEachIndex}-${info.retry}`;
      await signInWith(page, who, ['kontrolle', 'verwaltung']);
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('tab', { name: 'Profil' }).click();
      await expect(page.getByTestId('roles-card')).toBeVisible();
      await expect(page.getByTestId('roles-card')).toContainText('Baumkontrolle');

      await setRoles(world, who, ['verwaltung']);
      // the tab coming back to the front is an automatic sync trigger (docs/07)
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(page.getByTestId('roles-card')).not.toContainText('Baumkontrolle', { timeout: 20_000 });
      await expect(page.getByRole('dialog', { name: 'Einstellungen' })).toBeVisible();
    });
  });
}
