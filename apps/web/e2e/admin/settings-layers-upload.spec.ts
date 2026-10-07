import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { goldenData, goldenFile } from '../golden';
import { publish } from '../support/publish';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-406: Projekteinstellungen > Kartenebenen > "Hochladen" (v3 `LayersSection.svelte:712-795`) against the real built
 * process, at phone (390x844) and desktop (1280x800) size: upload a small MBTiles file, see it processed, the layer appears
 * in the list (and so in the draft), publish, and a participant reads the archive from the layer's address.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844, key: 'kachelnphone' },
  { name: 'desktop', width: 1280, height: 800, key: 'kacheldesktop' },
] as const;
/** A 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

let admins = 0;
const dir = mkdtempSync(join(tmpdir(), 'tile-upload-e2e-'));
const MBTILES = join(dir, 'Luftbild.mbtiles');

test.beforeAll(async ({ playwright, baseURL }) => {
  const db = new Database(MBTILES);
  db.exec(
    'CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)',
  );
  db.prepare('INSERT INTO metadata VALUES (?, ?)').run('format', 'png');
  db.prepare('INSERT INTO tiles VALUES (0, 0, 0, ?)').run(PNG);
  db.close();

  createAdmin('kacheln-deploy@example.org');
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'kacheln-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  for (const size of SIZES) {
    expect(admin(['create-project', size.key, `Kacheln ${size.name}`]).status).toBe(0);
    expect(admin(['add-membership', 'kacheln-deploy@example.org', size.key, 'sachbearbeiter']).status).toBe(
      0,
    );
    const deploy = await ctx.post(`/api/admin/p/${size.key}/deploy`, {
      data: goldenData('projects/stadtwerke-meldungen.yaml'),
    });
    expect(await deploy.json()).toMatchObject({ ok: true });
  }
  await ctx.dispose();
});
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function signIn(page: Page, key: string): Promise<void> {
  const email = `kacheln${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, key, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: upload an MBTiles file, the layer is added, publish, a participant reads the archive', async ({
      page,
      playwright,
      baseURL,
    }) => {
      await signIn(page, size.key);
      await page.goto(`/admin/projects/${size.key}/settings?section=layers`);
      await page.getByRole('button', { name: 'Layer hinzufügen' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Kartenebene hinzufügen' });
      await dialog.getByRole('tab', { name: 'Hochladen' }).click();
      const panel = dialog.locator('[role="tabpanel"][data-state="active"]');

      // A wrong file type is not offered; the format buttons rest once the file says its own format.
      await panel.getByLabel('Kacheldatei').setInputFiles(MBTILES);
      await expect(panel.getByLabel('Name')).toHaveValue('Luftbild');
      await expect(panel.getByText('Das Format wird aus der Datei gelesen.')).toBeVisible();
      await expect(panel.getByRole('button', { name: 'PNG' })).toBeDisabled();
      await panel.getByRole('button', { name: 'Kacheln hochladen' }).click();

      await expect(page.getByText('Kachelverarbeitung abgeschlossen').first()).toBeVisible();
      await expect(dialog).toBeHidden(); // v3 closes the dialog once the tiles are processed
      await expect(page.getByTestId('publish-bar')).toBeVisible();
      const table = page.getByTestId('layers-table');
      await expect(table.locator('[data-row-id="luftbild"]')).toBeVisible();
      await expect(table.locator('[data-row-id="luftbild"]')).toContainText('Luftbild');

      // Publish, then read the layer as a participant: its address serves the archive.
      await page.goto(`/admin/projects/${size.key}/settings?section=lifecycle`);
      await publish(page, { via: 'lifecycle' });

      const added = admin(['participant', 'add', size.key, `Anna ${Date.now()}`, 'melder']);
      expect(added.status).toBe(0);
      const id = /with id (\S+?)\.?$/m.exec(added.out)?.[1] ?? '';
      const token = admin(['participant', 'qr', size.key, id]).out.trim().split('\n').at(-1) ?? '';
      const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
      expect((await ctx.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
      const bootstrap = await (await ctx.get('/participant-api/bootstrap')).json();
      const layer = bootstrap.compiled.file.map?.layers?.luftbild;
      expect(layer).toMatchObject({
        kind: 'overlay',
        source: { type: 'pmtiles', tile_type: 'raster' },
        minzoom: 0,
        maxzoom: 0,
      });
      expect(layer.source.url).toMatch(new RegExp(`^/api/p/${size.key}/tiles/archives/[0-9a-f]+\\.pmtiles$`));
      const range = await ctx.get(layer.source.url, { headers: { range: 'bytes=0-6' } });
      expect(range.status()).toBe(206);
      expect((await range.body()).toString('latin1')).toBe('PMTiles');
      await ctx.dispose();
    });
  });
}
