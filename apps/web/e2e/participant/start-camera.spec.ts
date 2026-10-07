import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData, goldenFile } from '../golden';
import { rosterToken } from '../seed';

/**
 * WP-731: a role whose home view has no locations (Hanna, handwerker: work orders without a geometry) and a project
 * without `map.start` opens the map where v3 opened without one (`MapCanvas.svelte:198-199`: 7.45 / 51.505), not on
 * the renderer's Central Europe. WP-741 (owner answer M6 a): the maengelmelder template now sets `map.start` on Bonn, so
 * Hanna opens there; the default-camera fallback (no `map.start`) stays proved by shell/initial-view.spec.ts.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
// Per repeat (`--repeat-each`) its own project and admin: the data directory outlives a repeat.
let KEY = 'startstadt0';
let EMAIL = 'start0@example.org';
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
  KEY = `startstadt${n}`;
  EMAIL = `start${n}@example.org`;
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

const SIZES = [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;
for (const [size, screen] of SIZES) {
  test.describe(size, () => {
    test.use(screen);

    test('a home view without locations opens at the template map.start (Bonn)', async ({
      page,
      context,
      baseURL,
    }) => {
      const token = rosterToken(E2E_DATA_DIR, KEY, 'p-hanna', ['handwerker']);
      const res = await context.request.post(`${baseURL}/api/auth/exchange`, { data: { token } });
      expect(res.status()).toBe(200);
      await page.goto('/');
      const map = page.getByTestId('map');
      await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
      await expect(map).toHaveAttribute('data-idle', 'true', { timeout: 30_000 });
      await expect
        .poll(async () => {
          const [lon, lat] = ((await map.getAttribute('data-center')) ?? '0,0').split(',').map(Number);
          return Math.abs((lon ?? 0) - 7.11) < 0.05 && Math.abs((lat ?? 0) - 50.755) < 0.05;
        })
        .toBe(true);
    });
  });
}
