import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openControlDb, openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-441: the data table's "Erstellt von" names every kind of actor: an admin by e-mail, an import with the admin who
 * ran it, the system as "System"; an id nobody knows shows as it is. At phone and desktop size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'erstellerstadt';
const EMAIL = 'namen@example.org';
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const id = (n: number): string => `00000000-0000-7000-8000-00000000f${String(n).padStart(3, '0')}`;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

function seed(creators: readonly string[]): void {
  const db = openProjectDb(E2E_DATA_DIR, PROJECT);
  const put = db.prepare(
    `INSERT INTO features (id, type, config_version, properties, geometry, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, 'baum', 1, ?, ?, 7.1, 50.7, 0, 'active', ?, '2026-03-01T10:00:00.000Z', '2026-03-04T10:00:00.000Z')`,
  );
  creators.forEach((by, i) =>
    put.run(
      id(i + 1),
      JSON.stringify({ stage: 'kontrolliert', befund: `Befund ${i + 1}` }),
      JSON.stringify({ type: 'Point', coordinates: [7.1, 50.7] }),
      by,
    ),
  );
  db.close();
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(180_000);
  expect(admin(['create-project', PROJECT, PROJECT]).status).toBe(0);
  createAdmin(EMAIL);
  expect(admin(['add-membership', EMAIL, PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect((await ctx.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } })).status()).toBe(
    200,
  );
  const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  expect(await (await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: file })).json()).toMatchObject({
    ok: true,
  });
  await ctx.dispose();
  const control = openControlDb(`${E2E_DATA_DIR}/control.db`);
  const accountId = control.prepare<{ id: string }>('SELECT id FROM accounts WHERE email = ?').get(EMAIL)?.id;
  control.close();
  expect(accountId).toBeDefined();
  seed([accountId ?? '', `import:${accountId}`, 'system', 'unbekannt-x']);
});

async function open(page: Page): Promise<void> {
  await signInAs(page, EMAIL);
  await expect(page).toHaveURL(/\/admin\/projects/);
  await page.goto(`/admin/projects/${PROJECT}/types/baum`);
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('"Erstellt von" shows admin, import, system and unknown actors by name', async ({ page }) => {
      await open(page);
      const cell = (n: number) => page.locator(`tbody tr[data-row-id="${id(n)}"]`);
      await expect(cell(1)).toContainText(EMAIL);
      await expect(cell(2)).toContainText(`Import (${EMAIL})`);
      await expect(cell(3)).toContainText('System');
      await expect(cell(4)).toContainText('unbekannt-x');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}
