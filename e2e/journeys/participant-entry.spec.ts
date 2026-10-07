import { expect, test, type Page } from '@playwright/test';
import { waitsFor } from './lib/fixme';
import { issueToken, qrLink, seedJourneyWorld, signInByLink } from './lib/world';

/**
 * Participant entry, session and app chrome (register p1-entry-settings). v3's sign-in lives at /login with two tabs;
 * the app starts at /map. Journeys follow v3's routes and German labels (reference/messages/de.json). Until the
 * screen is ported a journey is `test.fixme`; turn it green by deleting the fixme and the `waitsFor` details.
 * Harness proof: PE-01 runs today against whatever UI lands after the QR link.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedJourneyWorld(playwright, baseURL ?? '');
});

const MAP = /\/map$/;

async function openMapSignedIn(page: Page): Promise<void> {
  await signInByLink(page);
  await expect(page).toHaveURL(MAP);
}

// Purpose: let a participant get from the printed sheet to the map with nothing but the phone camera.
// v3: reference/src/routes/(participant)/login/+page.server.ts:64-101   Taps in v3: 0
test('PE-01 QR link signs in [harness proof]', async ({ page }) => {
  // the token travels in the fragment (v4 wire; v3 used ?token=), so no server log ever sees it
  await page.goto(qrLink(issueToken()));
  await expect(page).not.toHaveURL(/\/login/);
  // signed in: the login page does not come back
  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
});

// Purpose: let a participant type or paste the Zugangstoken from the printed sheet (or the admin's copy button).
// v3: reference/src/routes/(participant)/login/+page.svelte:173-383   Taps in v3: 2
test.fixme('PE-02 Token tab signs in', waitsFor('the participant login'), async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Token-Anmeldung' }).click();
  await page.getByLabel('Zugangstoken').fill(issueToken());
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(MAP);
});

// Purpose: let a participant sign in by pointing the phone at the printed QR inside the app, or from a photo of it.
// v3: reference/src/routes/(participant)/login/+page.svelte:143-152   Taps in v3: 2
test.fixme('PE-03 In-app scanner signs in', waitsFor('the participant login'), async ({ page, context }) => {
  // the camera is mocked: a fake media stream and a decoder that returns the token of the printed QR
  await context.grantPermissions(['camera']);
  const token = issueToken();
  await page.addInitScript((t) => {
    Object.defineProperty(window, '__qrScanResult', { value: t });
  }, token);
  await page.goto('/login');
  await page.getByRole('tab', { name: 'QR-Code' }).click();
  await page.getByRole('button', { name: 'Start Camera' }).click();
  await expect(page.getByText('QR-Code erkannt! Wird authentifiziert...')).toBeVisible();
  await expect(page).toHaveURL(MAP);
});

// Purpose: let a participant open the app on a day without network and find the session, the data and the map as they were.
// v3: reference/src/routes/(participant)/+layout.svelte:207-209   Taps in v3: 0
test.fixme(
  'PE-04 Session survives a reload',
  waitsFor('the participant shell'),
  async ({ page, context }) => {
    await openMapSignedIn(page);
    await page.reload();
    await expect(page).toHaveURL(MAP);
    // the same session works offline: the layout checks the token expiry locally
    await context.setOffline(true);
    await page.reload();
    await expect(page).toHaveURL(MAP);
    await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible();
  },
);

// Purpose: let a participant sign out without losing work that has not reached the office yet.
// v3: reference/src/routes/(participant)/map/+page.svelte:2459-2472   Taps in v3: 3
// Owner decision: v3 deleted the whole device database on logout, unsent runs included, with no warning (register p1 bug list). v4 keeps unsent changes.
test.fixme(
  'PE-05 Logout keeps unsent changes',
  waitsFor('the participant shell'),
  async ({ page, context }) => {
    await openMapSignedIn(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Einstellungen' }).click();
    await page.getByRole('tab', { name: 'Profil' }).click();
    await page.getByRole('button', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/login/);
    await context.setOffline(false);
    // the same participant signs in again: the unsent change is still in the list and is sent
    await page.goto(qrLink(issueToken()));
    await page.getByRole('button', { name: 'Einstellungen' }).click();
    await expect(page.getByRole('heading', { name: 'Ausstehende Änderungen' })).toBeVisible();
  },
);

// Purpose: let a participant adjust the app to themselves: theme, font size (XS to XL) and language.
// v3: reference/src/routes/(participant)/map/components/SettingsSheet.svelte:556-563   Taps in v3: 3
test.fixme(
  'PE-06 Einstellungen sets theme, font size and language',
  waitsFor('the participant settings'),
  async ({ page }) => {
    await openMapSignedIn(page);
    await page.getByRole('button', { name: 'Einstellungen' }).click();
    await page.getByRole('tab', { name: 'Optionen' }).click();
    await page.getByRole('radio', { name: 'Dunkel' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('radio', { name: 'XL' }).click();
    await page.getByRole('combobox', { name: 'Sprache' }).selectOption('en');
    // every label is in English afterwards, and the choice survives a reload
    await expect(page.getByRole('tab', { name: 'Options' })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  },
);

// Purpose: let a participant check whether work has reached the office: online state, last sync, pending count, and sync now.
// v3: reference/src/routes/(participant)/map/components/SettingsSheet.svelte:401-497   Taps in v3: 2
test.fixme(
  'PE-07 Einstellungen: Jetzt synchronisieren shows the sync state',
  waitsFor('the participant settings'),
  async ({ page }) => {
    await openMapSignedIn(page);
    await page.getByRole('button', { name: 'Einstellungen' }).click();
    await page.getByRole('tab', { name: 'Profil' }).click();
    await expect(page.getByText('Online')).toBeVisible();
    await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click();
    await expect(page.getByText(/Zuletzt synchronisiert/)).toBeVisible();
    await expect(page.getByText('Keine Änderungen zum Synchronisieren.')).toBeVisible();
  },
);
