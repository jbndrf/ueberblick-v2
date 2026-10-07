import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { goldenFile } from '../golden';

/**
 * WP-710/WP-721: after an applicant submits a Veranstaltung (`beantragen` creates it in the start stage, its `then` moves it
 * to Eingereicht in the same run) the Aktivität tab shows where the feature stands, once, against the built process.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
// own project keys: admin/builder-stage.spec.ts also creates `stagestadt`, and the early return below then skipped the setup
const KEY = 'aktivstadt';
const KEY_MAENGEL = 'aktivmaengel';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const { defaultBrowserType: _unused, ...PIXEL } = devices['Pixel 7'];
void _unused;

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  // a repeat (--repeat-each) runs this again on the same server: an existing project is already deployed
  if (admin(['create-project', KEY, KEY]).status !== 0) return;
  expect(admin(['create-project', KEY_MAENGEL, KEY_MAENGEL]).status).toBe(0);
  const created = admin(['create-admin', 'stage@example.org']);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', 'stage@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'stage@example.org', KEY, 'verwaltung']).status).toBe(0);
  expect(admin(['add-membership', 'stage@example.org', KEY_MAENGEL, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/veranstaltung/1.0.0.yaml')]).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/maengelmelder/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'stage@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'veranstaltung@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  const deployMaengel = await ctx.post(`/api/admin/p/${KEY_MAENGEL}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'maengelmelder@1' },
  });
  expect(await deployMaengel.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/** Header button on a desktop; on a phone the bar has no Zuletzt: the + opens Neu, the second tap opens Zuletzt beside it (v3 BottomControlBar.svelte:54-57). */
async function openRecent(page: Page, size: string): Promise<void> {
  if (size === 'phone') {
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    await page.getByRole('button', { name: 'Menü schließen', exact: true }).first().click();
  } else await page.getByRole('button', { name: 'Zuletzt' }).first().click();
}

const SIZES = [
  ['phone', PIXEL],
  ['desktop', { viewport: { width: 1280, height: 800 } }],
] as const;
for (const [size, screen] of SIZES) {
  test.describe(size, () => {
    test.use({ ...screen, locale: 'de-DE' });

    test('Aktivität of a submitted Veranstaltung shows the stage it moved to, once, after Erstellt', async ({
      page,
    }) => {
      const token = rosterToken(E2E_DATA_DIR, KEY, 'p-olga', ['antragsteller']);
      expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
      const submitted = await page.request.post(`/api/p/${KEY}/runs`, {
        data: {
          id: `00000000-0000-7000-8000-${String(Date.now() % 1e12).padStart(12, '0')}`,
          task: 'beantragen',
          configVersion: 1,
          clientTime: new Date().toISOString(),
          input: {
            titel: 'Wochenmarkt 9',
            datum: '2099-05-01',
            geometrie: {
              type: 'Polygon',
              coordinates: [
                [
                  [7.1, 50.7],
                  [7.101, 50.7],
                  [7.101, 50.701],
                  [7.1, 50.7],
                ],
              ],
            },
          },
        },
      });
      expect(await submitted.json()).toMatchObject({ outcome: 'accepted' });

      await page.goto('/map');
      await openRecent(page, size);
      await page.getByTestId('recent-row').filter({ hasText: 'Wochenmarkt 9' }).first().click();
      await page.getByRole('tab', { name: 'Aktivität' }).click();

      // the run created it in Entwurf and moved it to Eingereicht: one visit, in the stage it stands in, no Entwurf
      // WP-721: v3's "Erstellt" entry (activity-sections.ts) comes from the audit fields the sync page carries, once
      // with the start stage (Entwurf) once, then the current stage once; the creator is the person's name, else "Jemand"
      const created = page.getByTestId('activity-entry').filter({ hasText: 'Erstellt' });
      await expect(created).toHaveCount(1);
      await expect(created).toBeVisible();
      await expect(created).toContainText('Entwurf');
      await expect(created).toContainText('p-olga');
      const visits = page.getByTestId('activity-stage');
      await expect(visits).toHaveCount(1);
      await expect(visits).toBeVisible();
      await expect(visits).toContainText('Verschoben nach: Eingereicht');
      await expect(page.getByRole('tabpanel').getByText('Entwurf')).toHaveCount(1);
    });

    // WP-794 (owner M8 = b): "Erstellt" is the server receive time, as v3's pb created. Work done three days ago
    // (an offline device, its run stamped then) and synced now reads "gerade eben", not "vor 3 Tg".
    test('Erstellt shows the sync time of an offline-made create, not its work time', async ({ page }) => {
      const token = rosterToken(E2E_DATA_DIR, KEY, 'p-olga', ['antragsteller']);
      expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
      const worked = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const submitted = await page.request.post(`/api/p/${KEY}/runs`, {
        data: {
          id: `00000000-0000-7000-8000-${String((Date.now() + 7) % 1e12).padStart(12, '0')}`,
          task: 'beantragen',
          configVersion: 1,
          clientTime: worked,
          input: {
            titel: 'Wochenmarkt 10',
            datum: '2099-05-01',
            geometrie: {
              type: 'Polygon',
              coordinates: [
                [
                  [7.1, 50.7],
                  [7.101, 50.7],
                  [7.101, 50.701],
                  [7.1, 50.7],
                ],
              ],
            },
          },
        },
      });
      expect(await submitted.json()).toMatchObject({ outcome: 'accepted' });

      await page.goto('/map');
      await openRecent(page, size);
      await page.getByTestId('recent-row').filter({ hasText: 'Wochenmarkt 10' }).first().click();
      await page.getByRole('tab', { name: 'Aktivität' }).click();
      const created = page.getByTestId('activity-entry').filter({ hasText: 'Erstellt' });
      await expect(created).toHaveCount(1);
      await expect(created).toBeVisible();
      await expect(created).toContainText(/gerade eben|vor \d+ Min/);
      await expect(created).not.toContainText('3 Tg');
    });

    // WP-726: a create from the app carries a time, so the audit fields know the creation. v3 showed it as one entry,
    // "Erstellt · {stage}" (v3 feature detail module, :1435), never also as "Verschoben nach" the start stage.
    test('Aktivität of a created Mangel shows the start stage once, as Erstellt', async ({ page }) => {
      const token = rosterToken(E2E_DATA_DIR, KEY_MAENGEL, 'p-mia', ['melder']);
      expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
      const submitted = await page.request.post(`/api/p/${KEY_MAENGEL}/runs`, {
        data: {
          id: `00000000-0000-7000-8000-${String((Date.now() + 7) % 1e12).padStart(12, '0')}`,
          task: 'melden',
          configVersion: 1,
          clientTime: new Date().toISOString(),
          input: {
            geometrie: { type: 'Point', coordinates: [7.1, 50.7] },
            kategorie: 'strasse',
            beschreibung: { de: 'Schlagloch Hauptstrasse 12' },
          },
        },
      });
      expect(await submitted.json()).toMatchObject({ outcome: 'accepted' });

      await page.goto('/map');
      await openRecent(page, size);
      await page.getByTestId('recent-row').filter({ hasText: 'Meldung #' }).first().click();
      await page.getByRole('tab', { name: 'Aktivität' }).click();

      const created = page.getByTestId('activity-entry').filter({ hasText: 'Erstellt' });
      await expect(created).toHaveCount(1);
      await expect(created).toBeVisible();
      await expect(created).toContainText('Offen');
      await expect(page.getByTestId('activity-stage')).toHaveCount(0);
      await expect(page.getByRole('tabpanel').getByText('Offen')).toHaveCount(1);
    });
  });
}
