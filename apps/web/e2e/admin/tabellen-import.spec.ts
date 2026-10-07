import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-433 (owner A8): 'CSV importieren' on a Tabelle page (v3 `custom-tables/[tableId]/+page.svelte:237`) opens the shared
 * wizard; each row is a `$create` run. At phone and desktop size: upload, Zuordnen (no coordinates, no stage), Vorschau,
 * import, and the rows show in the table.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'tabimport';
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

const createCount = (): number => {
  const db = openProjectDb(E2E_DATA_DIR, PROJECT);
  const n = (
    db
      .prepare<{ n: number }>(
        "SELECT COUNT(*) AS n FROM runs WHERE task = '$create' AND outcome = 'accepted'",
      )
      .get() as { n: number }
  ).n;
  db.close();
  return n;
};

async function deploy(ctx: APIRequestContext): Promise<void> {
  const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  const res = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: file });
  expect(await res.json()).toMatchObject({ ok: true });
}

const DEPLOYER = 'tabimpdeploy@example.org';
let admins = 0;
async function signIn(page: Page): Promise<void> {
  const email = `tabimp${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(180_000);
  expect(admin(['create-project', PROJECT, PROJECT]).status).toBe(0);
  createAdmin(DEPLOYER);
  expect(admin(['add-membership', DEPLOYER, PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect(
    (await ctx.post('/api/auth/login', { data: { email: DEPLOYER, password: PASSWORD } })).status(),
  ).toBe(200);
  await deploy(ctx);
  await ctx.dispose();
});

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('import 3 rows into a Tabelle: they show in the table, one $create run each', async ({ page }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/tables/baumart`);
      const before = createCount();
      const csv = [
        'Name;Lateinischer Name',
        `Hainbuche ${name};Carpinus betulus`,
        `Spitzahorn ${name};Acer platanoides`,
        `Vogelkirsche ${name};Prunus avium`,
      ].join('\n');

      await page.getByTestId('csv-import-button').click();
      const dialog = page.getByTestId('csv-import');
      await expect(dialog.getByText('CSV-Daten importieren')).toBeVisible();
      await page
        .getByTestId('csv-file')
        .setInputFiles({ name: 'arten.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await expect(page.getByTestId('import-found')).toContainText('3 Zeilen gefunden');
      await expect(page.getByTestId('map-0')).toHaveValue('name_de');
      await expect(page.getByTestId('map-1')).toHaveValue('name_lat');
      await expect(page.locator('#import-stage')).toHaveCount(0); // a Tabelle has no stage
      expect(await noOverflow(page)).toBe(true);
      await page.getByTestId('import-next').click();

      await expect(page.getByTestId('import-ready')).toContainText('3 Zeilen sind bereit zum Import.');
      await expect(page.getByTestId('import-preview')).toContainText(`Hainbuche ${name}`);
      expect(await noOverflow(page)).toBe(true);
      await page.getByTestId('import-start').click();
      await expect(page.getByTestId('import-result')).toContainText('CSV erfolgreich importiert (3)');
      await page.getByTestId('import-table').click();
      await expect(dialog).toBeHidden();
      for (const species of ['Hainbuche', 'Spitzahorn', 'Vogelkirsche'])
        await expect(
          page.locator('tbody tr[data-row-id]').filter({ hasText: `${species} ${name}` }),
        ).toBeVisible();
      expect(createCount()).toBe(before + 3);
      expect(await noOverflow(page)).toBe(true);
    });
  });
}
