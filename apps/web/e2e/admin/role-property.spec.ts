import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { publish } from '../support/publish';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-463: role properties (A-051; WP-455, WP-459) at phone and desktop size. A `role` property is deployed (the Rollen
 * source of the builder writes exactly this type); the admin surfaces show the role LABEL, never the key: Daten, Objekt
 * detail and the Tabellen grid. The CSV wizard maps a column to the role property and takes a key or a label; an
 * unknown role is a named row problem.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const BAUM = '00000000-0000-7000-8000-0000000000b1';
const ART = '00000000-0000-7000-8000-0000000000a1';

test.use({ locale: 'de-DE' });

async function deploy(ctx: APIRequestContext, project: string): Promise<void> {
  const file = parse(readFileSync(OVERLAY, 'utf8')) as { add: Record<string, unknown> };
  file.add['types.baum.properties.rollenzustaendig'] = {
    type: 'role',
    label: { de: 'Zuständige Rolle', en: 'Responsible role' },
  };
  file.add['tasks.erfassen.form.rollenzustaendig'] = {}; // the wizard maps the creating task's form fields
  file.add['types.baumart.properties.betreut_von'] = {
    type: 'role',
    label: { de: 'Betreut von', en: 'Looked after by' },
  };
  const res = await ctx.post(`/api/admin/p/${project}/deploy`, { data: file });
  const body = await res.json();
  expect(body, JSON.stringify(body)).toMatchObject({ ok: true });
}

function seed(project: string): void {
  const db = openProjectDb(E2E_DATA_DIR, project);
  const put = db.prepare(
    `INSERT INTO features (id, type, config_version, properties, geometry, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'active', 'someone', '2026-01-01T08:00:00.000Z', '2026-02-01T08:00:00.000Z')`,
  );
  put.run(
    BAUM,
    'baum',
    JSON.stringify({ stage: 'kontrolliert', befund: 'Rollenbaum', rollenzustaendig: 'bauhof' }),
    JSON.stringify({ type: 'Point', coordinates: [7.1, 50.1] }),
    7.1,
    50.1,
    1,
  );
  put.run(
    ART,
    'baumart',
    JSON.stringify({ name_de: 'Rollenart', betreut_von: 'kontrolle' }),
    null,
    null,
    null,
    2,
  );
  db.close();
}

let admins = 0;
async function signIn(page: Page, project: string): Promise<void> {
  const email = `roleprop${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, project, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(180_000);
  createAdmin('rolepropdeploy@example.org');
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  for (const name of Object.keys(VIEWPORTS)) {
    const p = `rolprop_${name}`;
    expect(admin(['create-project', p, p]).status).toBe(0);
    expect(admin(['add-membership', 'rolepropdeploy@example.org', p, 'verwaltung']).status).toBe(0);
  }
  expect(
    (
      await ctx.post('/api/auth/login', {
        data: { email: 'rolepropdeploy@example.org', password: PASSWORD },
      })
    ).status(),
  ).toBe(200);
  for (const name of Object.keys(VIEWPORTS)) {
    await deploy(ctx, `rolprop_${name}`);
    seed(`rolprop_${name}`);
  }
  await ctx.dispose();
});

const noScroll = async (page: Page): Promise<void> => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });
    const project = `rolprop_${name}`;

    test('Daten, Objekt detail and Tabellen show the role label, not the key', async ({ page }) => {
      await signIn(page, project);

      await page.goto(`/admin/projects/${project}/types/baum`);
      const row = page.locator('tbody tr[data-row-id]').filter({ hasText: 'Rollenbaum' });
      await expect(row).toBeVisible();
      await expect(row.getByText('Bauhof')).toBeVisible();
      await expect(row.getByText('bauhof', { exact: true })).toHaveCount(0);
      await noScroll(page);

      await row.getByText('Rollenbaum').click();
      await expect(page.getByTestId('data-row-rollenzustaendig')).toContainText('Bauhof');
      await expect(page.getByTestId('data-row-rollenzustaendig')).not.toContainText('bauhof');
      await noScroll(page);

      await page.goto(`/admin/projects/${project}/tables/baumart`);
      const cell = page.locator('tbody tr[data-row-id]').filter({ hasText: 'Rollenart' });
      await expect(cell).toBeVisible();
      await expect(cell.getByText('Baumkontrolle')).toBeVisible();
      await expect(cell.getByText('kontrolle', { exact: true })).toHaveCount(0);
      await noScroll(page);
    });

    test('Tabellen: the role cell is an editable select of the project roles, saved as one Admin-Korrektur', async ({
      page,
    }) => {
      await signIn(page, project);
      await page.goto(`/admin/projects/${project}/tables/baumart`);
      const row = page.locator('tbody tr[data-row-id]').filter({ hasText: 'Rollenart' });
      await expect(row).toBeVisible();
      await page.getByRole('switch', { name: 'Bearbeitungsmodus' }).click();
      await row.getByRole('button', { name: 'Baumkontrolle', exact: true }).click();
      await row.locator('[aria-expanded]:not([data-slot])').click(); // the cell's select opens (a sheet on the phone)
      // phone: a sheet of radios; desktop: a listbox
      const choice = (label: string): Locator =>
        page.getByRole(name === 'phone' ? 'radio' : 'option', { name: label });
      await expect(choice('Bauhof')).toBeVisible();
      await expect(choice('Verwaltung')).toBeVisible();
      await choice('Bauhof').click();
      await row.getByRole('button', { name: 'Speichern', exact: true }).click(); // the cell
      await noScroll(page);
      await row.getByRole('button', { name: 'Änderungen dieser Zeile speichern' }).click();
      await expect(page.getByText('Gespeichert').first()).toBeVisible();
      // the row was seeded straight into `features` (no observation), so the cell is judged by the run it wrote
      const db = openProjectDb(E2E_DATA_DIR, project);
      const last = db
        .prepare<{ result: string }>(
          'SELECT result FROM observations WHERE feature_id = ? AND property = ? ORDER BY seq DESC LIMIT 1',
        )
        .get(ART, 'betreut_von');
      db.close();
      expect(last?.result).toBe('"bauhof"');
    });

    test('CSV import: a role column takes key or label; an unknown role is refused with the row named', async ({
      page,
    }) => {
      await signIn(page, project);
      await page.goto(`/admin/projects/${project}/types/baum`);
      const csv = [
        'Vitalität (Roloff);Zuständige Rolle;lat;lon',
        'v1;bauhof;50.20;7.20',
        'v2;Verwaltung;50.21;7.21',
        'v1;Gärtner;50.22;7.22',
      ].join('\n');
      await page.getByTestId('csv-import-button').click();
      await page
        .getByTestId('csv-file')
        .setInputFiles({ name: 'rollen.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await expect(page.getByTestId('import-found')).toContainText('3 Zeilen gefunden');
      await expect(page.getByTestId('map-1')).toHaveValue('rollenzustaendig');
      await page.locator('#import-stage').selectOption('kontrolliert');
      await noScroll(page);
      await page.getByTestId('import-next').click();
      await expect(page.getByTestId('import-ready')).toContainText('2 Zeilen sind bereit zum Import.');
      await expect(page.getByTestId('import-problems')).toContainText('Zeile 3');
      await expect(page.getByTestId('import-start')).toBeDisabled();
      await page.getByLabel('Fehlerhafte Zeilen überspringen und die übrigen importieren').check();
      await noScroll(page);
      await page.getByTestId('import-start').click();
      await expect(page.getByTestId('import-result')).toContainText('CSV erfolgreich importiert (2)');
      await page.getByTestId('import-table').click();
      const rows = page.locator('tbody tr[data-row-id]');
      await expect(rows.filter({ hasText: 'Verwaltung' })).toHaveCount(1); // the label was accepted
      await expect(rows.filter({ hasText: 'Bauhof' }).first()).toBeVisible(); // the key was accepted
    });
  });
}

/**
 * The builder part: the third "Auswählen aus" card, Rollen, makes the field a `role` property (A-051); Speichern,
 * Veröffentlichen, and the data page shows the role label for a row that holds the key.
 */
test.describe('builder: the Rollen source', () => {
  test.beforeAll(async ({ playwright, baseURL }) => {
    test.setTimeout(180_000);
    const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
    expect(
      (
        await ctx.post('/api/auth/login', {
          data: { email: 'rolepropdeploy@example.org', password: PASSWORD },
        })
      ).status(),
    ).toBe(200);
    for (const name of Object.keys(VIEWPORTS)) {
      const p = `rolbuild_${name}`;
      expect(admin(['create-project', p, p]).status).toBe(0);
      expect(admin(['add-membership', 'rolepropdeploy@example.org', p, 'verwaltung']).status).toBe(0);
      const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
      const res = await ctx.post(`/api/admin/p/${p}/deploy`, { data: file });
      expect(await res.json()).toMatchObject({ ok: true });
    }
    await ctx.dispose();
  });

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
      test.use({ viewport, hasTouch: name === 'phone' });

      test('pick Rollen, save, publish; the data page shows the role label', async ({ page }) => {
        const project = `rolbuild_${name}`;
        await signIn(page, project);
        await page.goto(`/admin/projects/${project}/types/baum/builder`);
        const frame = page.getByTestId('builder-frame');
        const press = async (target: Locator): Promise<void> =>
          name === 'phone' ? target.tap() : target.click();
        if (name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator('[data-path="tasks.kontrolle"]').click();
        const pane = page.getByTestId('task-pane');
        await pane.getByTestId('tab-form').click();
        await pane.getByTestId('step-0-edit').click();
        await press(page.getByTestId('tile-custom_table_selector'));
        const key = (await page.getByTestId('field-card').last().getAttribute('data-key')) ?? '';
        await press(page.locator(`[data-key="${key}"] .badge.type`));
        const panel = page.getByTestId('field-config');
        await press(panel.getByTestId('entity-source-roles').getByRole('radio'));
        await expect(panel.getByTestId('entity-source-roles').getByRole('radio')).toHaveAttribute(
          'aria-checked',
          'true',
        );
        if (name === 'phone') await page.keyboard.press('Escape');
        await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
        await expect(page.getByTestId('unsaved')).toBeHidden();
        await publish(page, { via: 'bar' });

        const db = openProjectDb(E2E_DATA_DIR, project);
        db.prepare(
          `INSERT INTO features (id, type, config_version, properties, geometry, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
           VALUES (?, 'baum', 1, ?, NULL, NULL, NULL, 1, 'active', 'someone', '2026-01-01T08:00:00.000Z', '2026-02-01T08:00:00.000Z')`,
        ).run(BAUM, JSON.stringify({ stage: 'kontrolliert', befund: 'Builderbaum', [key]: 'verwaltung' }));
        db.close();
        await page.goto(`/admin/projects/${project}/types/baum`);
        const row = page.locator('tbody tr[data-row-id]').filter({ hasText: 'Builderbaum' });
        await expect(row.getByText('Verwaltung')).toBeVisible();
        await expect(row.getByText('verwaltung', { exact: true })).toHaveCount(0);
      });
    });
  }
});
