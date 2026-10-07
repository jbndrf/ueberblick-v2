import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData, goldenFile } from '../golden';
import { rosterToken } from '../seed';

/**
 * WP-712: a project without a base layer is drawn on the OSM default base (v3 `default-osm`). The tile proxy serves it,
 * so no tile request of the map answers 404 (before, about 220 did and the map was empty). Whether the upstream is
 * reachable is not the point: the proxy answers 200 or 502, never 404.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
// Per repeat (`--repeat-each`) its own project and admin: the data directory outlives a repeat.
let KEY = 'basestadt0';
let EMAIL = 'base0@example.org';
const PASSWORD = 'correct horse battery';
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
  const n = test.info().repeatEachIndex;
  KEY = `basestadt${n}`;
  EMAIL = `base${n}@example.org`;
  expect(admin(['create-project', KEY, KEY]).status).toBe(0);
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', EMAIL, KEY, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/maengelmelder/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + 30_000) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

// A 1x1 transparent PNG: stands in for the upstream so the test does not depend on the network.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const SIZES = [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;
for (const [size, screen] of SIZES) {
  test.describe(size, () => {
    test.use(screen);

    test('a project without a base layer draws the default-osm base: tiles are requested, served 200, the credit shows', async ({
      page,
      context,
      baseURL,
    }) => {
      const token = rosterToken(E2E_DATA_DIR, KEY, 'p-base', ['sachbearbeiter']);
      const res = await context.request.post(`${baseURL}/api/auth/exchange`, { data: { token } });
      expect(res.status()).toBe(200);
      // The map only asks for tiles of a source that exists with a visible raster layer, so a served tile proves the base.
      await page.route(new RegExp(`/api/p/${KEY}/tiles/default-osm/`), (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
      );
      const tiles: number[] = [];
      page.on('response', (r) => {
        if (new RegExp(`/api/p/${KEY}/tiles/default-osm/`).test(r.url())) tiles.push(r.status());
      });
      await page.goto('/');
      await expect.poll(() => tiles.length, { timeout: 20_000 }).toBeGreaterThan(0);
      expect(tiles.every((s) => s === 200)).toBe(true);
      // v3 credits compactly on both sizes (MapCanvas.svelte:1031, `compact: true`: the (i) button that folds the credit
      // away); the credit text is there when the map shows. On the phone the bottom bar (v3 BottomControlBar.svelte:68,
      // fixed over the map as in v3) sits over the credit corner, so only its presence is asserted there.
      await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveClass(/maplibregl-compact/);
      await expect(page.getByText(/OpenStreetMap/).first()).toBeVisible();
    });

    test('without a stub no tile request answers 404 (the proxy answers 200 or 502)', async ({
      page,
      context,
      baseURL,
    }) => {
      const token = rosterToken(E2E_DATA_DIR, KEY, 'p-base', ['sachbearbeiter']);
      const res = await context.request.post(`${baseURL}/api/auth/exchange`, { data: { token } });
      expect(res.status()).toBe(200);
      const tiles: number[] = [];
      page.on('response', (r) => {
        if (new RegExp(`/api/p/${KEY}/tiles/default-osm/`).test(r.url())) tiles.push(r.status());
      });
      await page.goto('/');
      await expect.poll(() => tiles.length, { timeout: 20_000 }).toBeGreaterThan(0);
      expect(tiles.filter((s) => s === 404)).toEqual([]);
    });
  });
}
