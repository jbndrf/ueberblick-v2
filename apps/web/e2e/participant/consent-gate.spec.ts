import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';
import { createInstanceStore, openControlDb, openProjectDb, setSelfJoin } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';

/**
 * WP-704: the consent gate (WP-638) on the paths other than the plain sign-in form, against the built process at phone
 * and desktop size. With consent required, `/join/<slug>` and `/login?token=` show the consent first and create / sign in nothing
 * until it is accepted; with it off both go straight through; the footer legal pages open in place (v3 `:105-120`).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KEY = 'consentstadt';
const SLUG = 'maengel-consentstadt';
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
const SCREENS = [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;

const MODAL = 'consent-modal';
const clock = { now: (): string => new Date().toISOString() };
function withStore<T>(fn: (store: ReturnType<typeof createInstanceStore>) => T): T {
  const control = openControlDb(`${E2E_DATA_DIR}/control.db`);
  try {
    return fn(createInstanceStore(control, clock as never));
  } finally {
    control.close();
  }
}
function requireConsent(on: boolean): void {
  withStore((s) =>
    s.saveSettings({
      requireConsent: on,
      consentTitle: '',
      consentBody: '',
      acceptLabel: '',
      rejectLabel: '',
    }),
  );
}
const guests = (): number => {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    return db.prepare<{ n: number }>('SELECT count(*) AS n FROM participants').get()?.n ?? -1;
  } finally {
    db.close();
  }
};
const sessionCookies = async (page: Page): Promise<string[]> =>
  (await page.context().cookies())
    .map((c) => c.name)
    .filter((n) => n !== 'consent' && n !== 'PARAGLIDE_LOCALE');

test.beforeAll(async () => {
  spawnSync('npm', ['run', '--silent', 'admin', '--', 'create-project', KEY, KEY], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR },
  });
  const control = openControlDb(`${E2E_DATA_DIR}/control.db`);
  const row = control.prepare<{ id: string }>('SELECT id FROM projects WHERE key = ?').get(KEY);
  expect(
    setSelfJoin({ control, now: () => new Date() }, row?.id ?? '', 'melder', { enabled: true, slug: SLUG })
      .ok,
  ).toBe(true);
  control.close();
  // the server's timers migrate a new project database at the same moment; open it until both are done
  await expect(() => guests()).toPass({ timeout: 10_000 });
  withStore((s) => {
    s.savePage({
      slug: 'datenschutz',
      title: 'Datenschutz E2E',
      body: '<p>Wir speichern wenig.</p>',
      sortOrder: 1,
      showInConsentFooter: true,
    });
  });
});
test.afterAll(() => {
  requireConsent(false);
  withStore((s) => s.removePage('datenschutz'));
});

for (const [size, screen] of SCREENS) {
  test.describe(size, () => {
    test.use(screen);
    test.describe('consent required', () => {
      test.beforeEach(() => requireConsent(true));

      test('a guest link shows the consent first; declining keeps the guest out', async ({ page }) => {
        const before = guests();
        await page.goto(`/join/${SLUG}`);
        await expect(page.getByTestId(MODAL)).toBeVisible();
        await expect(page).toHaveURL(/\/login\?returnTo=/);
        await page.getByRole('button', { name: 'Ablehnen' }).click();
        await expect(page.getByTestId(MODAL)).toBeVisible();
        await expect(page).toHaveURL(/\/login/);
        expect(guests()).toBe(before);
        expect(await sessionCookies(page)).toEqual([]);
      });

      test('accepting creates the guest and opens the map without another tap', async ({ page }) => {
        const before = guests();
        await page.goto(`/join/${SLUG}`);
        await expect(page.getByTestId(MODAL)).toBeVisible();
        expect(guests()).toBe(before);
        const joinPost = page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().includes(`/join/${SLUG}/start`),
        );
        await page.getByRole('button', { name: 'Akzeptieren' }).click();
        // The join POST must carry the real Origin (a full navigation leaves /login's no-referrer document): 303, not 403.
        expect((await joinPost).status()).toBe(303);
        await page.waitForURL(/\/map$/, { waitUntil: 'commit' });
        expect(guests()).toBe(before + 1);
      });

      test('a token link waits for the consent and signs in only after accepting', async ({ page }) => {
        const token = rosterToken(E2E_DATA_DIR, KEY, 'p-consent-token', ['melder']);
        await page.goto(`/login?token=${encodeURIComponent(token)}`);
        await expect(page.getByTestId(MODAL)).toBeVisible();
        expect(await sessionCookies(page)).toEqual([]);
        await expect(page).toHaveURL(/\/login$/);
        await page.getByRole('button', { name: 'Akzeptieren' }).click();
        await page.waitForURL(/\/map$/, { waitUntil: 'commit' });
        expect(await sessionCookies(page)).not.toEqual([]);
      });

      test('the footer legal link opens the page in place and goes back', async ({ page }) => {
        await page.goto('/login');
        await page.getByRole('button', { name: 'Datenschutz E2E' }).click();
        await expect(page.getByText('Wir speichern wenig.')).toBeVisible();
        await page.getByRole('button', { name: 'Zurück' }).click();
        await expect(page.getByRole('button', { name: 'Akzeptieren' })).toBeVisible();
      });
    });

    test.describe('consent not required', () => {
      test.beforeEach(() => requireConsent(false));

      test('a guest link goes straight to the map', async ({ page }) => {
        const before = guests();
        await page.goto(`/join/${SLUG}`);
        await page.waitForURL(/\/map$/, { waitUntil: 'commit' });
        expect(guests()).toBe(before + 1);
      });

      test('a token link signs in without any consent', async ({ page }) => {
        const token = rosterToken(E2E_DATA_DIR, KEY, 'p-free-token', ['melder']);
        await page.goto(`/login?token=${encodeURIComponent(token)}`);
        await page.waitForURL(/\/map$/, { waitUntil: 'commit' });
        await expect(page.getByTestId(MODAL)).toHaveCount(0);
      });
    });
  });
}
