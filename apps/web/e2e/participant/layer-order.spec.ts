import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { goldenFile } from '../golden';

/**
 * WP-709: the participant shell has one layer order. With a feature open, Einstellungen and Werkzeuge open ABOVE its
 * sheet (hit-tested, not just visible), a Zuletzt row and the second + are not eaten by the picker's backdrop, and
 * Escape closes the topmost layer only. Against the built process, on a desktop and on a phone.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KEY = 'layerstadt';
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
  admin(['create-project', KEY, KEY]);
  const created = admin(['create-admin', 'layer@example.org']);
  if (!created.out.includes('otpauth://')) return; // a restarted worker: the project is deployed already
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', 'layer@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'layer@example.org', KEY, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/maengelmelder/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'layer@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'maengelmelder@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/**
 * The element at the centre of `el` is `el` or inside it: nothing stands over it. Polled, because a panel that
 * slides in is not yet at its place on the first sample; the end state is what counts.
 */
async function onTop(el: Locator): Promise<boolean> {
  await expect(el).toBeVisible();
  const sample = (): Promise<boolean> =>
    el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 24));
      return hit !== null && node.contains(hit);
    });
  try {
    await expect.poll(sample, { timeout: 5_000 }).toBe(true);
    return true;
  } catch {
    return false;
  }
}

async function openWithFeature(page: Page, id: string): Promise<void> {
  const token = rosterToken(E2E_DATA_DIR, KEY, id, ['melder']);
  expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  await page.goto('/map');
  // one Mangel, so that its sheet stands open (Neu closes after Absenden and opens the detail, v3 `afterCreate`)
  await page.getByRole('button', { name: 'Neu' }).first().click();
  await page.getByTestId('create-pill').first().click();
  await page.getByTestId('placement-confirm').click();
  await page.getByLabel('Kategorie').click();
  await page.getByText('Beleuchtung', { exact: true }).click();
  await page.getByLabel('Beschreibung').fill('Lampe defekt');
  await page.getByRole('button', { name: 'Absenden' }).click();
  await expect(page.getByTestId('feature-sheet')).toBeVisible({ timeout: 20_000 });
}

/** On a phone the feature sheet covers the bar (v3: ModuleShell is above the bar), so it is closed before the bar is used. */
async function reachBar(page: Page, phone: boolean): Promise<void> {
  if (!phone) return;
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('feature-sheet')).toBeHidden();
}

for (const [name, use] of [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', PIXEL],
] as const) {
  const phone = name === 'phone';
  test.describe(name, () => {
    test.use({ ...use, locale: 'de-DE' });

    test('Einstellungen opens above the feature sheet; Escape closes it alone', async ({ page }) => {
      await openWithFeature(page, `p-set-${name}`);
      await reachBar(page, phone);
      await page.getByRole('button', { name: 'Einstellungen' }).first().click();
      const title = page.getByRole('heading', { name: 'Einstellungen' });
      expect(await onTop(title)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(title).toBeHidden();
      if (!phone) await expect(page.getByTestId('feature-sheet')).toBeVisible();
    });

    test('the first + after creating a feature shows the picker (Bernd, WP-709)', async ({ page }) => {
      await openWithFeature(page, `p-first-${name}`);
      await reachBar(page, phone);
      await page.getByRole('button', { name: 'Neu' }).first().click();
      await expect(page.getByTestId('create-picker')).toBeVisible();
    });

    test('Escape closes the picker only, the feature sheet stays', async ({ page }) => {
      await openWithFeature(page, `p-esc-${name}`);
      await reachBar(page, phone);
      await page.getByRole('button', { name: 'Neu' }).first().click();
      const picker = page.getByTestId('create-picker');
      await expect(picker).toBeVisible();
      expect(await onTop(picker.getByTestId('create-pill').first())).toBe(true);
      await page.keyboard.press('Escape');
      await expect(picker).toBeHidden();
      if (!phone) await expect(page.getByTestId('feature-sheet')).toBeVisible();
    });

    test('with the picker open the second + and a Zuletzt row are hit, not the backdrop', async ({
      page,
    }) => {
      await openWithFeature(page, `p-zul-${name}`);
      await reachBar(page, phone);
      await page.getByRole('button', { name: 'Neu' }).first().click();
      await expect(page.getByTestId('create-picker')).toBeVisible();
      const second = page.getByRole('button', { name: phone ? 'Menü schließen' : 'Neu' }).first();
      expect(await onTop(second)).toBe(true);
      await second.click(); // v3 step 2 (BottomControlBar.svelte:54-57): Zuletzt opens, the picker moves left
      const recent = page.getByRole('dialog', { name: 'Zuletzt' });
      await expect(recent).toBeVisible();
      await expect(page.getByTestId('create-picker')).toBeVisible();
      const row = recent.getByRole('button').nth(1);
      expect(await onTop(row)).toBe(true);
    });
  });
}
