import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-364 (S3-22): v3's 'CSV importieren' on the data page, at phone and desktop size: upload, Zuordnen, Vorschau (the
 * dry run), progress and the table. A published project imports in `skip` mode with 'In Stufe importieren' and replaces
 * all-or-nothing; a project that was never published ends with 'Veröffentlichen und importieren' (owner A4).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

test.use({ locale: 'de-DE' });

// The overlay renames the label to 'Vitalität (Roloff)'; 'Beschreibung' is a localized text (the wizard names the language).
const CSV = [
  'Vitalität (Roloff);Beschreibung;lat;lon',
  'v1;Alte Linde;50.10;7.10',
  'v2;Buche am Weg;50.11;7.11',
  'v3;Eiche;abc;7.12',
  'v1;Ahorn;50.13;7.13',
  'v0;Birke;50.14;7.14',
].join('\n');
const CLEAN = ['Vitalität (Roloff);lat;lon', 'v1;50.20;7.20', 'v2;50.21;7.21'].join('\n');
const CSV_NEW = ['Vitalität;lat;lon', 'v1;50.20;7.20', 'v4;50.21;7.21', 'v2;50.22;7.22'].join('\n');

let admins = 0;
async function deploy(ctx: APIRequestContext, project: string): Promise<void> {
  const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  const res = await ctx.post(`/api/admin/p/${project}/deploy`, { data: file });
  expect(await res.json()).toMatchObject({ ok: true });
}
async function signIn(page: Page, projects: readonly string[]): Promise<void> {
  const email = `csv${(admins += 1)}@example.org`;
  createAdmin(email);
  for (const p of projects) expect(admin(['add-membership', email, p, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(120_000);
  createAdmin('csvdeploy@example.org');
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  for (const name of Object.keys(VIEWPORTS)) {
    const p = `csvpub_${name}`;
    expect(admin(['create-project', p, p]).status).toBe(0);
    expect(admin(['add-membership', 'csvdeploy@example.org', p, 'verwaltung']).status).toBe(0);
  }
  expect(
    (
      await ctx.post('/api/auth/login', { data: { email: 'csvdeploy@example.org', password: PASSWORD } })
    ).status(),
  ).toBe(200);
  for (const name of Object.keys(VIEWPORTS)) await deploy(ctx, `csvpub_${name}`);
  await ctx.dispose();
});

const upload = (page: Page, csv: string): Promise<void> =>
  page
    .getByTestId('csv-file')
    .setInputFiles({ name: 'baeume.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
const rows = (page: Page) => page.locator('tbody tr[data-row-id]');
const noScroll = async (page: Page): Promise<void> => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });
    const project = `csvpub_${name}`;

    test('a published project: map, preview with a bad row, import into a stage, then replace all-or-nothing', async ({
      page,
    }) => {
      await signIn(page, [project]);
      await page.goto(`/admin/projects/${project}/types/baum`);
      await expect(rows(page)).toHaveCount(0);

      await page.getByTestId('csv-import-button').click();
      const dialog = page.getByTestId('csv-import');
      await expect(dialog.getByText('CSV-Daten importieren')).toBeVisible();

      // 1 + 2: upload and map (auto-mapped by label and coordinate names)
      await upload(page, CSV);
      await expect(page.getByTestId('import-found')).toContainText('5 Zeilen gefunden – 4 Spalten gefunden');
      await expect(page.getByTestId('map-0')).toHaveValue('vitalitaet');
      await expect(page.getByTestId('map-1')).toHaveValue('beschreibung');
      await expect(page.getByTestId('map-2')).toHaveValue('$lat');
      await expect(page.getByTestId('map-3')).toHaveValue('$lon');
      await page.locator('#import-stage').selectOption('kontrolliert'); // 'In Stufe importieren'
      await noScroll(page);
      await page.getByTestId('import-next').click();

      // 3: the dry run: 4 rows ready, row 3 is named
      await expect(page.getByTestId('import-ready')).toContainText('4 Zeilen sind bereit zum Import.');
      await expect(page.getByTestId('import-problems')).toContainText('Zeile 3');
      await expect(page.getByTestId('import-preview')).toContainText('Alte Linde');
      await expect(page.getByTestId('import-start')).toBeDisabled(); // all-or-nothing with a bad row
      await page.getByLabel('Fehlerhafte Zeilen überspringen und die übrigen importieren').check();
      await noScroll(page);
      await page.getByTestId('import-start').click();

      // 4: the result, then the table
      await expect(page.getByTestId('import-result')).toContainText('CSV erfolgreich importiert (4)');
      await page.getByTestId('import-table').click();
      await expect(dialog).toBeHidden();
      await expect(rows(page)).toHaveCount(4);
      await expect(page.getByText('Kontrolliert').first()).toBeVisible();

      // replace: the checkbox warns and forces all-or-nothing; a bad row keeps the old data (the dry run blocks it)
      await page.getByTestId('csv-import-button').click();
      await upload(page, CSV);
      await page.getByTestId('import-next').click();
      await page.getByLabel('Alle vorhandenen Daten ersetzen (sonst anhängen)').check();
      await expect(page.getByTestId('import-replace-warning')).toBeVisible();
      await expect(page.getByTestId('import-start')).toBeDisabled();
      await page.getByRole('button', { name: 'Zurück' }).click();
      await page.getByRole('button', { name: 'Zurück' }).click();
      await page.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(rows(page)).toHaveCount(4);

      // replace with a clean file: the old four are gone, the two new ones stay
      await page.getByTestId('csv-import-button').click();
      await upload(page, CLEAN);
      await page.getByTestId('import-next').click();
      await page.getByLabel('Alle vorhandenen Daten ersetzen (sonst anhängen)').check();
      await page.getByTestId('import-start').click();
      await expect(page.getByTestId('import-result')).toContainText('CSV erfolgreich importiert (2)');
      await page.getByTestId('import-table').click();
      await expect(rows(page)).toHaveCount(2);
    });

    test('a project that was never published: Veröffentlichen und importieren', async ({ page }) => {
      await signIn(page, []);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Csv neu ${name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const fresh = `csv_neu_${name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${fresh}/participants$`));
      await page.goto(`/admin/projects/${fresh}/types/baum`);
      await expect(page.getByText('noch nicht veröffentlicht')).toBeVisible();

      await page.getByTestId('csv-import-button').click();
      await upload(page, CSV_NEW);
      await expect(page.getByTestId('map-0')).toHaveValue('vitalitaet');
      await page.getByTestId('import-next').click();
      await expect(page.getByTestId('import-unpublished')).toContainText('nach der ersten Veröffentlichung');
      await noScroll(page);
      await page.getByRole('button', { name: 'Veröffentlichen und importieren' }).click();
      await expect(page.getByTestId('import-result')).toContainText('CSV erfolgreich importiert (3)');
      await page.getByTestId('import-table').click();
      await expect(rows(page)).toHaveCount(3);
      await expect(page.getByTestId('publish-bar')).toBeHidden();
    });
  });
}
