import { devices, expect, test } from '@playwright/test';
import qrcode from 'qrcode-generator';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import {
  disableParticipant,
  sessionExpiries,
  setCredentialExpiry,
  setParticipantRoles,
  setSessionExpiry,
} from './helpers/control';
import { KEY, fieldToken, seedWorld, signIn, watchErrors, allowErrors } from './world';

/**
 * WP-831 (verify, step 2): session and account of the participant, driven in the real app at phone (390x844) and
 * desktop (1280x800) size. v3: `reference/src/hooks.server.ts:69-103` (sliding session), `login/+page.server.ts:164-258`
 * (account checks), `+layout.svelte:207-209, 489-500` (expired session), `+layout.svelte:243-262` (device per
 * participant), `login/+page.svelte:91-152` (QR tab), `+layout.svelte:638-643` (UserCircle).
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

const DAY = 86_400_000;
const desktop = { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false } as const;
const uid = (what: string, size: string, info: { repeatEachIndex: number; retry: number }): string =>
  `p-v831-${what}-${size}-${info.repeatEachIndex}-${info.retry}`;

for (const size of ['phone', 'desktop'] as const) {
  test.describe(size, () => {
    if (size === 'desktop') test.use(desktop);
    let problems: string[] = [];
    test.beforeEach(({ page }) => {
      problems = watchErrors(page);
    });
    test.afterEach(() => {
      expect(problems).toEqual([]);
    });

    test('p1.sliding-90-day-session: using the app after a day moves the session end to 90 days from now; within a day it does not write', async ({
      page,
    }, info) => {
      const who = uid('slide', size, info);
      await signIn(page, who);
      const [first] = sessionExpiries(who);
      expect(Date.parse(first ?? '') - Date.now()).toBeGreaterThan(29 * DAY); // a fresh sign-in: the session starts at its term
      // 10 days left = the last renewal was 80 days ago: the next request renews
      const old = new Date(Date.now() + 10 * DAY);
      setSessionExpiry(who, old);
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(() => Date.parse(sessionExpiries(who)[0] ?? '') - Date.now())
        .toBeGreaterThan(89 * DAY);
      // renewed just now: a second use does not move it again
      const renewed = sessionExpiries(who)[0];
      await page.reload();
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      expect(sessionExpiries(who)[0]).toBe(renewed);
    });

    test('p1.account-checks-is-active-expires: an expired or deactivated account cannot sign in and sees why on /login', async ({
      page,
    }, info) => {
      allowErrors(problems, /40[13]/);
      const expired = uid('expired', size, info);
      const link = (t: string): string => `/login?token=${encodeURIComponent(t)}`;
      const token = rosterToken(E2E_DATA_DIR, KEY, expired, ['kontrolle']);
      setCredentialExpiry(expired, new Date(Date.now() - DAY));
      await page.goto(link(token));
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole('alert')).toBeVisible();

      const off = uid('off', size, info);
      const offToken = rosterToken(E2E_DATA_DIR, KEY, off, ['kontrolle']);
      disableParticipant(KEY, off);
      await page.goto(link(offToken));
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole('alert')).toBeVisible();
    });

    test('p1.expired-session-login-local-data: an ended session opens /login, the local copy stays, signing in again shows it', async ({
      page,
    }, info) => {
      allowErrors(problems, /401|Failed to load resource/);
      const who = uid('ended', size, info);
      await signIn(page, who);
      await page.getByRole('button', { name: 'Liste' }).click();
      await expect(page.getByRole('button', { name: /^Baum #/ }).first()).toBeVisible();
      setSessionExpiry(who, new Date(Date.now() - DAY));
      await page.goto('/map');
      await expect(page).toHaveURL(/\/login/);
      const databases = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
      expect(databases.some((n) => n?.endsWith(`-${who}`))).toBe(true);
      await page.goto(`/login?token=${encodeURIComponent(fieldToken(who))}`);
      await expect(page).toHaveURL(/\/map$/);
      await page.getByRole('button', { name: 'Liste' }).click();
      await expect(page.getByRole('button', { name: /^Baum #/ }).first()).toBeVisible();
    });

    test('p1.per-participant-device-db-role: two people on one device keep their own database; a removed role hides its task', async ({
      page,
    }, info) => {
      const a = uid('dev-a', size, info);
      const b = uid('dev-b', size, info);
      await signIn(page, a);
      await signIn(page, b);
      const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''));
      expect(names.filter((n) => n.endsWith(`-${a}`))).toHaveLength(1);
      expect(names.filter((n) => n.endsWith(`-${b}`))).toHaveLength(1);
      expect(new Set([a, b]).size).toBe(2);

      // a role change reaches the same device without a wipe: the task of the removed role disappears
      await page.getByRole('button', { name: 'Liste' }).click();
      await page
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      await expect(page.getByRole('button', { name: 'Befund ergänzen' })).toBeVisible();
      await page.getByRole('button', { name: 'Schließen' }).first().click();
      setParticipantRoles(KEY, b, ['verwaltung']);
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('tab', { name: 'Profil' }).click();
      await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click();
      await expect(page.getByTestId('roles-card')).not.toContainText('Baumkontrolle', { timeout: 20_000 });
      await page.getByRole('button', { name: 'Schließen' }).first().click();
      await page
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      await expect(page.getByRole('button', { name: 'Befund ergänzen' })).toHaveCount(0);
    });

    test('p1.qr-code-tab-in-app: the QR-Code tab offers Kamera starten and QR-Bild hochladen; an uploaded login-link image signs in', async ({
      page,
    }, info) => {
      allowErrors(problems, /Failed to load resource/);
      await page.goto('/login');
      await page.getByRole('tab', { name: 'QR-Code' }).click();
      await expect(page.getByRole('button', { name: 'Kamera starten' })).toBeEnabled({ timeout: 30_000 });
      await expect(page.getByText('QR-Bild hochladen')).toBeVisible();
      await expect(
        page.getByText('Scannen Sie einen QR-Code mit der Kamera oder laden Sie ein Bild hoch'),
      ).toBeVisible();
      // a picture without a code is explained, not swallowed
      await page.locator('input[type=file]').setInputFiles({
        name: 'leer.gif',
        mimeType: 'image/gif',
        buffer: Buffer.from('R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64'),
      });
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('kein QR-Code');
      // the printed link as an image
      const who = uid('qr', size, info);
      const url = `${new URL(page.url()).origin}/login?token=${encodeURIComponent(fieldToken(who))}`;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      const gif = qr.createDataURL(8, 16).split(',')[1] ?? '';
      await page.locator('input[type=file]').setInputFiles({
        name: 'login.gif',
        mimeType: 'image/gif',
        buffer: Buffer.from(gif, 'base64'),
      });
      // On a miss, name what the page said (a 429 from the per-address throttle reads differently from a decode
      // failure), so a red run in a loaded full suite is diagnosable without the trace.
      try {
        await expect(page).toHaveURL(/\/map$/, { timeout: 30_000 });
      } catch (err) {
        const said = await page
          .getByRole('alert')
          .allInnerTexts()
          .catch(() => []);
        throw new Error(`QR upload did not sign in; at ${page.url()}, alerts: ${JSON.stringify(said)}`, {
          cause: err,
        });
      }
    });

    test('p1.usercircle-konto: the account icon in the header opens Einstellungen', async ({
      page,
    }, info) => {
      await signIn(page, uid('konto', size, info));
      await page.getByRole('button', { name: 'Konto' }).click();
      await expect(page.getByRole('dialog', { name: 'Einstellungen' })).toBeVisible();
    });
  });
}
