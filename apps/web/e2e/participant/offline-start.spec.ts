import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { goldenFile } from '../golden';

/**
 * WP-717: the offline cold start against the built process. After one online visit the service worker holds the
 * shell, the build and every worker bundle (sync, photo, map), so a reload and a new page offline show the map
 * from the device, never "Wird geladen …" for good.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KEY = 'offlinestadt';
// one admin per run: `--repeat-each` runs this setup again on the same server
const EMAIL = `offline-${Date.now()}@example.org`;
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  admin(['create-project', KEY, KEY]);
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', EMAIL, KEY, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/maengelmelder/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'maengelmelder@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/**
 * No HTTP cache: a phone evicts it (or a proxy sends no-store), so only the service worker can serve a file offline.
 * With the browser cache on, the worker bundles of the online visit would still be found and hide a missing precache.
 */
const noHttpCache = async (page: Page): Promise<void> => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
};

const mapShown = async (page: Page): Promise<void> => {
  await expect(page.getByRole('button', { name: 'Neu' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Wird geladen')).toBeHidden();
};

const serverRuns = (): number => {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    return db.prepare<{ n: number }>("SELECT count(*) AS n FROM runs WHERE task = 'melden'").get()?.n ?? 0;
  } finally {
    db.close();
  }
};

/**
 * The cached data, not only the shell: the device's own store (IndexedDB) holds the Mangel and the page reads it.
 * A map shell without data fails here.
 */
const dataShown = async (page: Page): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          let total = 0;
          for (const { name } of await indexedDB.databases()) {
            if (name === undefined) continue;
            const db = await new Promise<IDBDatabase>((ok, fail) => {
              const r = indexedDB.open(name);
              r.onsuccess = () => ok(r.result);
              r.onerror = () => fail(r.error);
            });
            if (db.objectStoreNames.contains('features'))
              total += await new Promise<number>((ok, fail) => {
                const r = db.transaction('features').objectStore('features').count();
                r.onsuccess = () => ok(r.result);
                r.onerror = () => fail(r.error);
              });
            db.close();
          }
          return total;
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  // and the page reads it: the store holds the feature (above) and loading has finished; this does not assert what is drawn
  await expect(page.getByText('Wird geladen')).toBeHidden();
};

test('after one online visit, a reload and a new page offline show the map with its data', async ({
  page,
  context,
}) => {
  const before = serverRuns();
  const token = rosterToken(E2E_DATA_DIR, KEY, 'p-offline', ['melder']);
  expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  await page.goto('/map');
  await mapShown(page);
  // one Mangel while online; it is on the server once the device has synced it
  await page.getByRole('button', { name: 'Neu' }).first().click();
  await page.getByTestId('create-pill').first().click();
  await page.getByTestId('placement-confirm').click();
  await page.getByLabel('Kategorie').click();
  await page.getByText('Beleuchtung', { exact: true }).click();
  await page.getByLabel('Beschreibung').fill('Lampe defekt');
  await page.getByRole('button', { name: 'Absenden' }).click();
  await expect.poll(serverRuns, { timeout: 20_000 }).toBe(before + 1);
  await dataShown(page);
  // the worker has taken the page and finished installing (all precache entries stored)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const cached = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (k) =>
          (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname),
        ),
      )
    ).flat(),
  );
  for (const re of [/sync\.worker-.*\.js$/, /pack-writer\.worker-.*\.js$/, /maplibre-gl-worker\.mjs$/])
    expect(
      cached.some((p) => re.test(p)),
      String(re),
    ).toBe(true);

  await noHttpCache(page);
  await context.setOffline(true);
  await page.reload();
  await mapShown(page);
  await dataShown(page);

  // a second tab while the first still holds the sync lock: a follower, it must not wait for the leader
  const second = await context.newPage();
  await noHttpCache(second);
  await second.goto('/map');
  await mapShown(second);
  await dataShown(second);
  // and a start with no other tab open
  await second.close();
  await page.close();
  const third = await context.newPage();
  await noHttpCache(third);
  await third.goto('/map');
  await mapShown(third);
  await dataShown(third);
});
