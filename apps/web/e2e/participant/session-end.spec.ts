import { devices, expect, test } from '@playwright/test';
import { acceptedRuns, signInAs, test as refusal } from './refused-world';
import { allowErrors, seedWorld, signIn, watchErrors } from './world';

/**
 * WP-769 (device privacy hunt M1): the app does not outlive its session. An expired cached identity opens /login
 * offline, and a 401 from sync while online leads to /login; the person's local copy (and its queued runs) stays.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
refusal.use({ ...devices['Pixel 7'], locale: 'de-DE' });
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

const desktop = { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false } as const;
// Both sizes run the same journeys: v3 opens the same sheets from the same buttons at either size (Liste, Einstellungen).
for (const size of ['phone', 'desktop'] as const) {
  test.describe(`${size}: expiry`, () => {
    if (size === 'desktop') test.use(desktop);
    test('an expired cached identity opens the sign-in page offline, not the app', async ({
      page,
      context,
    }, info) => {
      await signIn(page, `p-expiry-${size}-${info.repeatEachIndex}-${info.retry}`);
      await page.evaluate(() => {
        const cached = JSON.parse(localStorage.getItem('ub:bootstrap') ?? '{}');
        cached.identity.session.expiresAt = '2020-01-01T00:00:00.000Z';
        localStorage.setItem('ub:bootstrap', JSON.stringify(cached));
      });
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready; // the shell is cached: the offline start is the worker's
      });
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
      await context.setOffline(true);
      await page.reload();
      await expect(page).toHaveURL(/\/login/);
      await context.setOffline(false);
    });
  });
}

/**
 * The run is queued offline, then the device comes back and the server answers 401. Either on sending the run (hold
 * `auth_expired`) or on the sync page: both lead to /login, the queue stays stored, and signing in again sends the run.
 */
const OFFLINE_NOISE =
  /participant sync:open: .*Failed to fetch|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/;
for (const size of ['phone', 'desktop'] as const)
  for (const ended of ['runs', 'sync'] as const) {
    refusal.describe(`${size}: 401`, () => {
      if (size === 'desktop') refusal.use(desktop);
      refusal(
        `a 401 on ${ended} while online leads to /login; the queued run survives and is sent after signing in again`,
        async ({ page, context, world }, info) => {
          void world;
          const problems = watchErrors(page);
          allowErrors(problems, OFFLINE_NOISE);
          allowErrors(problems, /401/);
          const who = `p-401-${size}-${ended}-${info.repeatEachIndex}-${info.retry}`;
          await signInAs(page, who);
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
          await page.getByRole('button', { name: 'Befund ergänzen' }).click();
          await page.getByLabel('Befund (Freitext)').fill('Pilz am Stamm');
          await page.getByRole('button', { name: 'Absenden' }).click();
          await expect(page.getByTestId('run-pending')).toBeVisible();
          await expect(page.getByTestId('run-pending')).toContainText('Noch nicht übertragen');
          const before = acceptedRuns('befund_ergaenzen');

          // the session is over on the server; for the sync case the run itself stays unsent (network failure)
          const dead = (route: { fulfill: (o: { status: number; body: string }) => Promise<void> }) =>
            route.fulfill({ status: 401, body: '{}' });
          if (ended === 'runs') await page.route('**/api/p/*/runs*', dead);
          else {
            await page.route('**/api/p/*/runs*', (route) => route.abort());
            await page.route('**/api/p/*/sync?*', dead);
          }
          await context.setOffline(false);
          await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

          // nothing was wiped: the person's database is still on the device and holds the run
          const kept = await page.evaluate(async (id) => {
            const db = (await indexedDB.databases()).find((d) => d.name?.endsWith(`-${id}`));
            if (!db?.name) return 'no database';
            const open = await new Promise<IDBDatabase>((ok, fail) => {
              const r = indexedDB.open(db.name as string);
              r.onsuccess = () => ok(r.result);
              r.onerror = () => fail(r.error);
            });
            const stores = [...open.objectStoreNames];
            const counts = await Promise.all(
              stores.map(
                (name) =>
                  new Promise<number>((ok) => {
                    const c = open.transaction(name).objectStore(name).count();
                    c.onsuccess = () => ok(c.result);
                  }),
              ),
            );
            open.close();
            return counts.some((n) => n > 0) ? 'has data' : 'empty';
          }, who);
          expect(kept).toBe('has data');
          expect(acceptedRuns('befund_ergaenzen')).toBe(before);

          // signing in again sends it
          await page.unroute('**/api/p/*/runs*');
          await page.unroute('**/api/p/*/sync?*').catch(() => undefined);
          await signInAs(page, who);
          await expect.poll(() => acceptedRuns('befund_ergaenzen'), { timeout: 30_000 }).toBe(before + 1);
        },
      );
    });
  }
