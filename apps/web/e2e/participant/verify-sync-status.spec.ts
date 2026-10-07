import { devices, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { allowErrors, watchErrors } from './world';
import { REFUSAL_KEY, ROLE, setRoles, signInAs, test } from './refused-world';

/**
 * WP-832 (verify, step 2): the sync status of the Profil tab in Einstellungen, driven in the real participant UI at
 * Pixel 7 and Desktop Chrome 1280x800, de-DE. v3: `SettingsSheet.svelte:401-514` (connection card, last synced, stale
 * line, pending line, roles), `freshness.ts:11-37`, `+layout.svelte:441-478` (catch-up on tab focus),
 * `ui-state.svelte.ts:32` (remembered tab). Reuses the world of refused-world.ts (project key `refusalstadt`).
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });

const OFFLINE_NOISE =
  /participant sync:open: .*Failed to fetch|net::ERR_INTERNET_DISCONNECTED|Failed to load resource|AJAXError: Failed to fetch \(0\): .*\/tiles\//;
const DAY = 86_400_000;

const person = (kind: string, info: TestInfo, size: string): string =>
  `p-sync-${kind}-${size}-${info.repeatEachIndex}-${info.retry}`;

async function openProfil(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('tab', { name: 'Profil' }).click();
}

async function closeSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Schließen' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Einstellungen' })).toHaveCount(0);
}

/** Adds a finding to the seeded tree while the device is offline; the run waits in the queue. */
async function reportOffline(page: Page, context: BrowserContext, problems: string[]): Promise<void> {
  await page.getByRole('button', { name: 'Liste' }).click();
  await page
    .getByRole('button', { name: /^Baum #/ })
    .first()
    .click();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });
  await context.setOffline(true);
  allowErrors(problems, OFFLINE_NOISE);
  await page.getByRole('button', { name: 'Befund ergänzen' }).click();
  await page.getByLabel('Befund (Freitext)').fill('Pilz am Stamm');
  await page.getByRole('button', { name: 'Absenden' }).click();
  await expect(page.getByTestId('run-pending')).toBeVisible();
  await expect(page.getByTestId('run-pending')).toContainText('Noch nicht übertragen');
  await closeSheet(page);
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

    // v3 `freshness.ts:11-37`, `SettingsSheet.svelte:433-449`; v4 persists lastSyncedAt (G9), so a reload keeps it.
    test('data freshness: "Zuletzt synchronisiert {ago}", kept over a reload; 7 days later the stale line warns', async ({
      page,
      world,
    }, info) => {
      expect(world.office).toBeDefined(); // the world is seeded (rosterToken needs the project)
      await signInAs(page, person('fresh', info, size));
      await openProfil(page);
      const card = page.getByTestId('sync-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText('Zuletzt synchronisiert', { timeout: 20_000 });
      await expect(card).not.toContainText('noch nie synchronisiert');
      await expect(card).not.toContainText('Tage alt');
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      await openProfil(page);
      await expect(page.getByTestId('sync-card')).toBeVisible();
      await expect(page.getByTestId('sync-card')).toContainText('Zuletzt synchronisiert', {
        timeout: 20_000,
      });
      await expect(page.getByTestId('sync-card')).not.toContainText('noch nie synchronisiert');
      // the device clock runs 8 days ahead: the data is old
      await closeSheet(page);
      await page.clock.setFixedTime(Date.now() + 8 * DAY);
      await openProfil(page);
      await expect(page.getByTestId('sync-card')).toBeVisible();
      await expect(page.getByTestId('sync-card')).toContainText(
        'Deine Daten sind 8 Tage alt. Verbinde dich, um zu aktualisieren.',
      );
    });

    // v3 `SettingsSheet.svelte:433-449`: a device that never synced says so.
    test('"Auf diesem Gerät noch nie synchronisiert" while no sync has finished', async ({
      page,
      context,
      world,
    }, info) => {
      expect(world.office).toBeDefined(); // the world is seeded (rosterToken needs the project)
      allowErrors(problems, OFFLINE_NOISE);
      await context.route(/\/api\/p\/[^/]+\/sync(?!\/events)/, (route) => route.abort());
      const who = person('never', info, size);
      await page.goto(
        `/login?token=${encodeURIComponent(rosterToken(E2E_DATA_DIR, REFUSAL_KEY, who, [ROLE]))}`,
      );
      await expect(page).toHaveURL(/\/map$/);
      await openProfil(page);
      const card = page.getByTestId('sync-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText('Auf diesem Gerät noch nie synchronisiert');
      await expect(card).not.toContainText('Zuletzt synchronisiert');
    });

    // v3 `+layout.svelte:441-478`: the data is made current when the person returns to the app, without a button.
    test('background catch-up: a tab coming back to the front pulls what changed on the server', async ({
      page,
      world,
    }, info) => {
      const who = person('focus', info, size);
      await signInAs(page, who);
      await setRoles(world, who, [ROLE, 'verwaltung']);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await openProfil(page);
      await expect(page.getByTestId('roles-card')).toBeVisible();
      await expect(page.getByTestId('roles-card')).toContainText('Verwaltung', { timeout: 20_000 });
    });

    // v3 `SettingsSheet.svelte:21`, `ui-state.svelte.ts:32`: the sheet opens on the tab the person used last.
    test('the sheet has the tabs Profil, Optionen, Offline and reopens on the last tab, also after a reload', async ({
      page,
    }, info) => {
      await signInAs(page, person('tabs', info, size));
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
      for (const name of ['Profil', 'Optionen', 'Offline'])
        await expect(dialog.getByRole('tab', { name })).toBeVisible();
      await expect(dialog.getByRole('tab', { name: 'Profil' })).toHaveAttribute('aria-selected', 'true');
      await dialog.getByRole('tab', { name: 'Optionen' }).click();
      await closeSheet(page);
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await expect(dialog.getByRole('tab', { name: 'Optionen' })).toHaveAttribute('aria-selected', 'true');
      await closeSheet(page);
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await expect(dialog.getByRole('tab', { name: 'Optionen' })).toHaveAttribute('aria-selected', 'true');
    });

    // v3 `SettingsSheet.svelte:450-466`: one sentence says whether anything is still on the phone only.
    test('the pending line: nothing to send, offline and saved locally, n waiting, then sent', async ({
      page,
      context,
    }, info) => {
      await signInAs(page, person('pending', info, size));
      await openProfil(page);
      const card = page.getByTestId('sync-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText('Keine Änderungen zum Synchronisieren.');
      await closeSheet(page);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 30_000,
      });
      await context.setOffline(true);
      allowErrors(problems, OFFLINE_NOISE);
      await openProfil(page);
      await expect(card).toBeVisible();
      await expect(card).toContainText('Offline');
      await expect(card).toContainText(
        'Keine ausstehenden Änderungen, aber neue Bearbeitungen werden lokal gespeichert.',
      );
      await closeSheet(page);
      await reportOffline(page, context, problems);
      await openProfil(page);
      await expect(card).toBeVisible();
      await expect(card).toContainText('1 nicht gespeicherte Änderung(en) warten auf den Upload.');
      await context.setOffline(false);
      await expect(card).toBeVisible();
      await expect(card).toContainText('Keine Änderungen zum Synchronisieren.', { timeout: 30_000 });
    });

    // v3 `TaskRunQueueList.svelte:26-71`: what is stuck, with its status, and Verwerfen without a confirmation.
    test('Ausstehende Änderungen lists the waiting run with its status; Verwerfen removes it', async ({
      page,
      context,
    }, info) => {
      await signInAs(page, person('list', info, size));
      await reportOffline(page, context, problems);
      await openProfil(page);
      const queue = page.getByTestId('run-queue');
      await expect(queue).toBeVisible();
      await expect(queue).toContainText('Ausstehende Änderungen');
      await expect(queue.getByRole('listitem')).toHaveCount(1);
      await expect(queue).toBeVisible();
      await expect(queue).toContainText('Wartet auf Übertragung');
      await queue.getByRole('button', { name: 'Verwerfen' }).click();
      await expect(page.getByTestId('run-queue')).toHaveCount(0);
      await expect(page.getByTestId('sync-card')).toBeVisible();
      await expect(page.getByTestId('sync-card')).toContainText('Offline');
    });

    // v3 `map/+page.svelte:2790` passed `roles={[]}`: the block never rendered (B14). v4 shows the real roles.
    test("the Rollen block shows the participant's roles as named in the project", async ({ page }, info) => {
      await signInAs(page, person('roles', info, size));
      await openProfil(page);
      const roles = page.getByTestId('roles-card');
      await expect(roles).toBeVisible();
      await expect(roles).toContainText('Rollen');
      await expect(roles).toContainText('Baumkontrolle');
      await expect(roles.getByText(ROLE, { exact: true })).toHaveCount(0);
    });
  });
}
