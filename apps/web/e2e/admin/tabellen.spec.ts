import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs, uniqueEmail } from './sign-in';
import { publish } from '../support/publish';

/**
 * WP-382 (S3-24): v3's custom tables. The sidebar's Tabellen entry opens the table page; a new row is ONE `$create` run,
 * a cell edit ONE `$correct` run, a deleted row ONE `$lifecycle` run; a new column goes into the draft, the publish bar
 * shows it and after publishing the column is there and editable; the first column is the Hauptspalte (Q15) and moves
 * with the order. At phone and desktop size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'tabstadt';
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

const runCount = (task: string): number => {
  const db = openProjectDb(E2E_DATA_DIR, PROJECT);
  const n = (
    db
      .prepare<{ n: number }>("SELECT COUNT(*) AS n FROM runs WHERE task = ? AND outcome = 'accepted'")
      .get(task) as { n: number }
  ).n;
  db.close();
  return n;
};

async function deploy(ctx: APIRequestContext): Promise<void> {
  const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  const res = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: file });
  expect(await res.json()).toMatchObject({ ok: true });
}

async function signIn(page: Page): Promise<void> {
  const email = uniqueEmail('tab');
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(180_000);
  // beforeAll runs again for each --repeat-each round on the same server: the project may exist, the admin is fresh
  admin(['create-project', PROJECT, PROJECT]);
  const DEPLOYER = uniqueEmail('tabdeploy');
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

/** Fills a cell of a BaseTable row (click the cell, type, Enter). */
async function fill(cell: Locator, page: Page, text: string): Promise<void> {
  await cell.click();
  const box = page.getByRole('textbox');
  await box.fill(text);
  await box.press('Enter');
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('the sidebar entry of a table opens the table page, whose columns follow the properties', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/participants`);
      if (name === 'phone') await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
      const link = page.getByTestId('group-tables').getByRole('link', { name: 'Baumart', exact: true });
      await expect(link).toHaveAttribute('href', `/admin/projects/${PROJECT}/tables/baumart`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${PROJECT}/tables/baumart$`));
      await expect(page.getByRole('heading', { level: 1, name: 'Baumart' })).toBeVisible();
      const heads = page.getByRole('columnheader');
      await expect(heads.filter({ hasText: 'Name' }).first()).toBeVisible();
      const texts = (await heads.allTextContents()).map((t) => t.trim());
      expect(texts.indexOf('Name')).toBeLessThan(texts.indexOf('Lateinischer Name'));
      expect(await noOverflow(page)).toBe(true);
    });

    test('the header is the shared block: an empty name is refused under the field, Escape cancels (WP-425)', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/tables/baumart`);
      await expect(page.getByTestId('table-name')).toBeVisible();
      await page.getByTestId('table-name').click();
      const box = page.getByTestId('table-name-input');
      await box.fill('');
      await box.press('Enter');
      await expect(page.getByTestId('table-name-error')).toBeVisible();
      await box.press('Escape');
      await expect(page.getByTestId('table-name-input')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: 'Baumart' })).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
    });

    test('rows are runs: add row makes one $create, a cell edit one $correct, delete one $lifecycle', async ({
      page,
    }) => {
      const tree = `Eiche ${name} ${Math.random().toString(36).slice(2, 7)}`;
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/tables/baumart`);
      const add = page.locator('[data-add-row]');
      const created = runCount('$create');
      // the columns of earlier rounds (published new columns) sit in front: find the two columns by their header
      const heads = (await page.getByRole('columnheader').allTextContents()).map((t) => t.trim());
      await fill(add.locator('td').nth(heads.indexOf('Name')).getByRole('button'), page, tree);
      await fill(
        add
          .locator('td')
          .nth(heads.findIndex((h) => h.startsWith('La')))
          .getByRole('button'),
        page,
        'Quercus',
      );
      await add.getByRole('button', { name: 'Zeile hinzufügen' }).click();
      const row = page.locator('tbody tr[data-row-id]').filter({ hasText: tree });
      await expect(row).toBeVisible();
      expect(runCount('$create')).toBe(created + 1);

      const corrected = runCount('$correct');
      await page.getByRole('switch', { name: 'Bearbeitungsmodus' }).click();
      await row.getByRole('button', { name: 'Quercus', exact: true }).click();
      const box = page.getByRole('textbox');
      await box.fill('Quercus robur');
      await box.press('Enter');
      await row.getByRole('button', { name: 'Änderungen dieser Zeile speichern' }).click();
      await expect(row.getByText('Quercus robur')).toBeVisible();
      expect(runCount('$correct')).toBe(corrected + 1);
      expect(await noOverflow(page)).toBe(true);

      const deleted = runCount('$lifecycle');
      await row.getByRole('button', { name: 'Menü öffnen' }).click();
      await page.getByRole('menuitem', { name: 'Löschen' }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Zeile löschen');
      expect(runCount('$lifecycle')).toBe(deleted);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
      await expect(row).toHaveCount(0);
      expect(runCount('$lifecycle')).toBe(deleted + 1);
    });

    test('a new column goes into the draft, shows in the publish bar and is editable after publishing; the order sets the Hauptspalte', async ({
      page,
    }) => {
      const uid = Math.random().toString(36).slice(2, 7);
      const column = `Alter ${name} ${uid}`;
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/tables/baumart`);
      await page.getByRole('columnheader').last().getByRole('button', { name: 'Spalte hinzufügen' }).click();
      const manager = page.getByTestId('column-manager');
      await manager.getByTestId('column-add').click();
      const form = page.getByRole('dialog', { name: 'Neue Spalte hinzufügen' });
      await form.getByLabel('Spaltenname').fill(column);
      await form.getByRole('button', { name: 'Spalte hinzufügen' }).click();
      await expect(manager.getByText(column)).toBeVisible();
      await expect(
        manager
          .getByRole('listitem')
          .filter({ hasText: column })
          .getByText('neu, wird mit Veröffentlichen aktiv'),
      ).toBeVisible();

      // the order: the top column is the Hauptspalte (Q15). Move the new column to the top, one step at a time: the
      // phone has the up button, the desktop the arrow keys on the grip (kit sortable, WP-408).
      const labels = manager.locator('[data-testid^="column-"] p');
      const at = (await labels.allTextContents()).findIndex((t) => t.trim() === column);
      for (let i = at; i > 0; i--) {
        if (name === 'phone') await manager.getByRole('button', { name: `Nach oben: ${column}` }).click();
        else {
          await manager.getByRole('button', { name: `Verschieben: ${column}` }).focus();
          await page.keyboard.press('ArrowUp');
        }
        await expect(labels.nth(i - 1)).toHaveText(column);
      }
      await expect(manager.getByRole('listitem').first().getByText('Haupt')).toBeVisible();
      await manager.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen' }).click();
      await expect(page.getByTestId('publish-bar')).toContainText('Unveröffentlichte Änderungen');

      await publish(page, { via: 'bar' });
      await page.reload();
      const heads = (await page.getByRole('columnheader').allTextContents()).map((t) => t.trim());
      expect(heads.indexOf(column)).toBeGreaterThanOrEqual(0);
      expect(heads.indexOf(column)).toBeLessThan(heads.indexOf('Name'));
      expect(await noOverflow(page)).toBe(true);

      // the new column is editable: a new row, then one correction run for it
      const add = page.locator('[data-add-row]');
      await fill(
        add.locator('td').nth(heads.indexOf('Name')).getByRole('button'),
        page,
        `Buche ${name} ${uid}`,
      );
      await add.getByRole('button', { name: 'Zeile hinzufügen' }).click();
      const row = page.locator('tbody tr[data-row-id]').filter({ hasText: `Buche ${name} ${uid}` });
      await expect(row).toBeVisible();
      const corrected = runCount('$correct');
      await page.getByRole('switch', { name: 'Bearbeitungsmodus' }).click();
      await row.locator('td').nth(heads.indexOf(column)).getByRole('button').click();
      const box = page.getByRole('textbox');
      await box.fill('17');
      await box.press('Enter');
      await row.getByRole('button', { name: 'Änderungen dieser Zeile speichern' }).click();
      await expect(row.getByText('17')).toBeVisible();
      expect(runCount('$correct')).toBe(corrected + 1);
    });

    test('the overview lists the tables, and a new table is made in its create row', async ({ page }) => {
      // a key per round: the project outlives --repeat-each rounds, and a table key is unique
      const table = `geraete_${name}_${Math.random().toString(36).slice(2, 7)}`;
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/participants`);
      if (name === 'phone') await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
      await page.getByTestId('tables-overview-link').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${PROJECT}/tables$`));
      // the sidebar sheet of a phone stays open after a link (the shell's behaviour); close it to work on the page
      if (name === 'phone') {
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-slot="sidebar"][data-mobile="true"]')).toBeHidden();
      }
      await expect(page.getByRole('heading', { level: 1, name: 'Tabellen' })).toBeVisible();
      await expect(page.locator('tbody tr[data-row-id="baumart"]')).toBeVisible();

      const add = page.locator('[data-add-row]');
      await fill(add.getByRole('button').nth(0), page, table);
      await fill(add.getByRole('button').nth(1), page, `Geräte ${name}`);
      await fill(add.getByRole('button').nth(3), page, 'Bezeichnung');
      await add.getByRole('button', { name: 'Zeile hinzufügen' }).click();
      await expect(page.locator(`tbody tr[data-row-id="${table}"]`)).toContainText(`Geräte ${name}`);
      await expect(page.getByTestId('publish-bar')).toContainText('Unveröffentlichte Änderungen');

      await page
        .locator(`tbody tr[data-row-id="${table}"]`)
        .getByRole('button', { name: 'Menü öffnen' })
        .click();
      await page.getByRole('menuitem', { name: 'Struktur bearbeiten' }).click();
      await expect(page).toHaveURL(new RegExp(`/tables/${table}$`));
      await expect(page.getByRole('heading', { level: 1, name: `Geräte ${name}` })).toBeVisible();
      await expect(page.getByTestId('table-unpublished')).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
    });
  });
}
