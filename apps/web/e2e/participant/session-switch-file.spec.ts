import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { rosterToken } from '../seed';

/**
 * WP-768 (review fix 1): the file upload is the first request a queued run makes, before the run itself. A second tab
 * that signs in as felix turns the cookie; the first tab (olga) must neither upload her file as felix nor send her run.
 * Asserted on the server's own tables: `blob_uploads` (the uploader) and `runs` (accepted runs of felix).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KEY = 'sessionfile';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
// a 1x1 PNG: the photo tool turns any image into a JPEG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
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
  admin(['create-project', KEY, KEY]); // a restarted worker finds it again
  const email = `sessionfile-${Date.now()}@example.org`;
  const created = admin(['create-admin', email]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', email, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', email, KEY, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/maengelmelder/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'maengelmelder@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/** Who uploaded files, and who has an accepted run, as the server recorded them. */
function recorded(): { uploaders: string[]; accepted: string[] } {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    return {
      uploaders: db
        .prepare<{ actor: string }>('SELECT actor FROM blob_uploads')
        .all()
        .map((r) => r.actor),
      accepted: db
        .prepare<{ actor: string }>("SELECT actor FROM runs WHERE outcome = 'accepted'")
        .all()
        .map((r) => r.actor),
    };
  } finally {
    db.close();
  }
}

for (const size of ['phone', 'desktop'] as const) {
  test.describe(size, () => {
    if (size === 'desktop')
      test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
    test("a queued run with a file: after a second tab signs in as felix, felix is never the uploader of olga's bytes", async ({
      page,
      context,
    }, info) => {
      const olga = `p-sf-a-${size}-${info.repeatEachIndex}-${info.retry}`;
      const felix = `p-sf-b-${size}-${info.repeatEachIndex}-${info.retry}`;
      const token = (who: string): string => rosterToken(E2E_DATA_DIR, KEY, who, ['melder']);
      expect((await page.request.post('/api/auth/exchange', { data: { token: token(olga) } })).status()).toBe(
        200,
      );
      await page.goto('/map');
      // the file and the run wait on this device: both endpoints are cut
      await page.route(`**/api/p/${KEY}/runs**`, (route) => route.abort());
      await page.route(`**/api/p/${KEY}/blobs/**`, (route) => route.abort());
      await page.getByRole('button', { name: 'Neu' }).first().click();
      await page.getByTestId('create-pill').first().click();
      await page.getByTestId('placement-confirm').click();
      await page.getByLabel('Kategorie').click();
      await page.getByText('Beleuchtung', { exact: true }).click();
      await page.getByLabel('Beschreibung').fill('Lampe defekt');
      await page
        .locator('input[type=file]')
        .last()
        .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
      await expect(page.getByRole('status').filter({ hasText: 'Foto hinzugefügt' })).toBeVisible();
      await page.getByRole('button', { name: 'Absenden' }).click();
      await page.waitForTimeout(2000); // the run is stored on the device; its sending is cut

      const second = await context.newPage();
      await second.goto(`/login?token=${encodeURIComponent(token(felix))}`);
      await expect(second).toHaveURL(/\/map$/);

      await page.unroute(`**/api/p/${KEY}/runs**`);
      await page.unroute(`**/api/p/${KEY}/blobs/**`);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForTimeout(4000);
      const seen = recorded();
      expect(seen.uploaders).not.toContain(felix);
      expect(seen.accepted).not.toContain(felix);
      expect(seen.accepted).not.toContain(olga);

      // proof that the run was queued all along: olga signs in again and her file and run go out under her own name
      await page.goto(`/login?token=${encodeURIComponent(token(olga))}`);
      await expect(page).toHaveURL(/\/map$/);
      await expect.poll(() => recorded().accepted, { timeout: 30_000 }).toContain(olga);
      expect(recorded().uploaders).toContain(olga);
      expect(recorded().uploaders).not.toContain(felix);
    });
  });
}
