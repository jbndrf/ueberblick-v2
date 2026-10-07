import { devices, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { allowErrors, watchErrors } from './world';
import { acceptedRuns, ROLE, setRoles, signInAs, test, type RefusalWorld } from './refused-world';

/**
 * WP-752: the refused and queued runs on the built app, at Pixel 7 and Desktop Chrome 1280x800, de-DE.
 * v3 sources: `task-runs/TaskRunNotices.svelte:4-37,105` (refusal notice with Erneut senden / Verwerfen, pending line),
 * `TaskRunQueueList.svelte:4-13` (every queued run in Einstellungen) and `SettingsSheet.svelte:458` (pending changes).
 * Every journey fails on a console error; the offline phase allows the sync worker's failed connection (reported).
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });

const OFFLINE_NOISE =
  /participant sync:open: .*Failed to fetch|net::ERR_INTERNET_DISCONNECTED|Failed to load resource|AJAXError: Failed to fetch \(0\): .*\/tiles\//;
// without the role the task's `when` fails only on the person's roles: core refuses `not_permitted` (WP-787; v3 "forbidden")
const REFUSAL = 'Du darfst diese Änderung nicht vornehmen.';

/** A participant of its own for this test, so queue and role changes never reach another test. */
const person = (kind: string, info: TestInfo, size: string): string =>
  `p-ref-${kind}-${size}-${info.repeatEachIndex}-${info.retry}`;

/**
 * Opens the seeded tree through the list, goes offline and adds a finding ("Befund ergänzen"); the sheet of the tree
 * stays open with the run waiting. The tree is on the server, so it stays on the device when the run is refused.
 */
async function reportOffline(page: Page, context: BrowserContext, problems: string[]): Promise<void> {
  await page.getByRole('button', { name: 'Liste' }).click();
  await page
    .getByRole('button', { name: /^Baum #/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Liste' }).click();
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
}

/** The role is taken away while the device is offline, then the device comes back: the server refuses the run. */
async function refuseOnReconnect(
  world: RefusalWorld,
  who: string,
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await setRoles(world, who, []);
  await context.setOffline(false);
  const notice = page.getByTestId('run-refused');
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText('Abgelehnt');
  await expect(notice).toContainText(REFUSAL);
  await expect(notice.getByRole('button', { name: 'Erneut senden' })).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Verwerfen' })).toBeVisible();
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

    test('refused run: the sentence with Erneut senden and Verwerfen; Verwerfen removes the run', async ({
      page,
      context,
      world,
    }, info) => {
      const who = person('discard', info, size);
      await signInAs(page, who);
      await reportOffline(page, context, problems);
      await refuseOnReconnect(world, who, page, context);
      await page.getByTestId('run-refused').getByRole('button', { name: 'Verwerfen' }).click();
      await expect(page.getByTestId('run-refused')).toHaveCount(0);
      await expect(page.getByTestId('run-pending')).toHaveCount(0);
      await page.getByRole('button', { name: 'Schließen' }).first().click();
      // gone from the device queue too: Einstellungen lists nothing
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('tab', { name: 'Profil' }).click();
      await expect(page.getByTestId('run-queue')).toHaveCount(0);
    });

    // v3 `resendTaskRun` ends in `notifyLocalWrite()` and uploads at once; so does `queue.resubmit` (WP-764).
    test('refused run: Erneut senden uploads the run by itself (D2)', async ({
      page,
      context,
      world,
    }, info) => {
      const who = person('resend-auto', info, size);
      await signInAs(page, who);
      const before = acceptedRuns('befund_ergaenzen');
      await reportOffline(page, context, problems);
      await refuseOnReconnect(world, who, page, context);
      await setRoles(world, who, [ROLE]);
      await page.getByTestId('run-refused').getByRole('button', { name: 'Erneut senden' }).click();
      await expect(page.getByTestId('run-refused')).toHaveCount(0);
      await expect.poll(() => acceptedRuns('befund_ergaenzen'), { timeout: 10_000 }).toBe(before + 1);
    });

    // v3 (`TaskRunQueueList.svelte`, `task-run-queue.svelte.ts:537-636`): a refused create leaves the map; a run that
    // builds on it is listed as "Folgeänderung abgelehnt" ("Beruht auf einer abgelehnten Änderung."). WP-767.
    test('refused create: the create and the run that builds on it are listed in Ausstehende Änderungen; Verwerfen removes the create', async ({
      page,
      context,
      world,
    }, info) => {
      const who = person('create', info, size);
      await signInAs(page, who);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 30_000,
      });
      await context.setOffline(true);
      allowErrors(problems, OFFLINE_NOISE);
      await page.getByRole('button', { name: 'Neu' }).first().click();
      await page.getByTestId('create-pill').first().click();
      await page.getByTestId('placement-confirm').click();
      await page.getByLabel('Vitalität (Stufe)').click();
      await page.getByText('2', { exact: true }).last().click();
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect(page.getByTestId('run-pending')).toBeVisible();
      await expect(page.getByTestId('run-pending')).toContainText('Noch nicht übertragen');
      // a second run on the new Objekt, still offline
      await page.getByRole('button', { name: 'Befund ergänzen' }).click();
      await page.getByLabel('Befund (Freitext)').fill('Pilz am Stamm');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await page.getByRole('button', { name: 'Schließen' }).first().click();
      await setRoles(world, who, []);
      await context.setOffline(false);
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('tab', { name: 'Profil' }).click();
      const queue = page.getByTestId('run-queue');
      const dependent = queue.getByRole('listitem').filter({ hasText: 'Folgeänderung abgelehnt' });
      await expect(dependent).toHaveCount(1, { timeout: 30_000 });
      await expect(dependent).toBeVisible();
      await expect(dependent).toContainText('Beruht auf einer abgelehnten Änderung.');
      // the Objekt is gone with its create: the title does not jump
      await expect(dependent.getByRole('button', { name: /^Objekt auf der Karte zeigen/ })).toHaveCount(0);
      const create = queue.getByRole('listitem').filter({ hasText: 'Abgelehnt' }).filter({
        hasNotText: 'Folgeänderung',
      });
      await expect(create).toHaveCount(1);
      await expect(create).toBeVisible();
      await expect(create).toContainText(REFUSAL);
      await expect(create.getByRole('button', { name: 'Erneut senden' })).toBeVisible();
      await create.getByRole('button', { name: 'Verwerfen' }).click();
      await expect(create).toHaveCount(0);
    });

    test('Einstellungen lists a pending run under Ausstehende Änderungen; its row opens the Objekt', async ({
      page,
      context,
    }, info) => {
      await signInAs(page, person('queue', info, size));
      await reportOffline(page, context, problems);
      await page.getByRole('button', { name: 'Schließen' }).first().click();
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('tab', { name: 'Profil' }).click();
      const queue = page.getByTestId('run-queue');
      await expect(queue).toBeVisible();
      await expect(queue).toContainText('Ausstehende Änderungen');
      await expect(queue.getByRole('listitem')).toHaveCount(1);
      await expect(queue).toBeVisible();
      await expect(queue).toContainText('Wartet auf Übertragung');
      await queue.getByRole('button', { name: /^Objekt auf der Karte zeigen/ }).click();
      await expect(page.getByRole('dialog', { name: 'Einstellungen' })).toHaveCount(0);
      await expect(page.getByTestId('run-pending')).toBeVisible();
      await expect(page.getByTestId('run-pending')).toContainText('Noch nicht übertragen');
    });

    test('Abmelden with a pending run asks first; Abbrechen keeps the run (v3 B3)', async ({
      page,
      context,
    }, info) => {
      await signInAs(page, person('signout', info, size));
      await reportOffline(page, context, problems);
      await page.getByRole('button', { name: 'Schließen' }).first().click();
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('tab', { name: 'Profil' }).click();
      await page.getByRole('button', { name: 'Abmelden' }).click();
      const ask = page.getByRole('alertdialog');
      await expect(ask).toBeVisible();
      await expect(ask).toContainText('Abmelden?');
      await expect(ask).toContainText('noch nicht gesendet');
      await ask.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(ask).toHaveCount(0);
      await expect(page).toHaveURL(/\/map$/);
      await expect(page.getByTestId('run-queue').getByRole('listitem')).toHaveCount(1);
    });
  });
}
