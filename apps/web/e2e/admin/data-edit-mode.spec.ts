import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-370 (owner answer A1): v3's Bearbeitungsmodus on the data page, saved as the system task 'Admin-Korrektur'. Three
 * edits in one row and the row's check make exactly ONE `$correct` run; the Objekt's Aktivität shows it under the
 * admin's name; the stage is read-only. At phone and desktop size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'editstadt';
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const id = (n: number): string => `00000000-0000-7000-8000-00000000e${String(n).padStart(3, '0')}`;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

// updated_seq 0: no observations back these rows, so every real run's observation (seq >= 1) is newer and fold keeps it.
function seed(): void {
  const db = openProjectDb(E2E_DATA_DIR, PROJECT);
  const put = db.prepare(
    `INSERT INTO features (id, type, config_version, properties, geometry, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, 'baum', 1, ?, ?, 7.1, 50.7, 0, 'active', 'someone', '2026-03-01T10:00:00.000Z', '2026-03-04T10:00:00.000Z')`,
  );
  for (let n = 1; n <= 4; n++)
    put.run(
      id(n),
      JSON.stringify({
        stage: 'kontrolliert',
        befund: `Befund ${n}`,
        hoehe_klasse: `klasse ${n}`,
        intern_notiz: `notiz ${n}`,
      }),
      JSON.stringify({ type: 'Point', coordinates: [7.1, 50.7] }),
    );
  db.close();
}

const correctRuns = (): { id: string; feature_id: string; actor_kind: string }[] => {
  const db = openProjectDb(E2E_DATA_DIR, PROJECT);
  const rows = db
    .prepare<{ id: string; feature_id: string; actor_kind: string }>(
      "SELECT id, feature_id, actor_kind FROM runs WHERE task = '$correct' AND outcome = 'accepted' ORDER BY rowid",
    )
    .all();
  db.close();
  return rows;
};

async function deploy(ctx: APIRequestContext): Promise<void> {
  const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  const res = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: file });
  expect(await res.json()).toMatchObject({ ok: true });
}

const DEPLOYER = 'editdeploy@example.org';
let admins = 0;
async function signIn(page: Page): Promise<string> {
  const email = `edit${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
  return email;
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
  seed();
});

async function editCell(page: Page, row: string, from: string, to: string): Promise<void> {
  await page
    .locator(`tbody tr[data-row-id="${row}"]`)
    .getByRole('button', { name: from, exact: true })
    .click();
  const box = page.getByRole('textbox');
  await box.fill(to);
  await box.press('Enter');
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });
    const feature = name === 'phone' ? id(1) : id(2);
    const n = name === 'phone' ? 1 : 2;

    test('three edits in one row and the check make one Admin-Korrektur; Aktivität shows it', async ({
      page,
    }) => {
      const email = await signIn(page);
      const before = correctRuns().length;
      await page.goto(`/admin/projects/${PROJECT}/types/baum`);
      const row = page.locator(`tbody tr[data-row-id="${feature}"]`);
      await expect(row).toBeVisible();

      await page.getByRole('switch', { name: 'Bearbeitungsmodus' }).click();
      await editCell(page, feature, `Befund ${n}`, 'Kronenpilz');
      await editCell(page, feature, `klasse ${n}`, 'gross');
      await editCell(page, feature, `notiz ${n}`, 'Wurzelfäule');
      expect(correctRuns()).toHaveLength(before); // nothing saved before the check

      // the check and x are 44 px targets and the edited row keeps its height
      const check = row.getByRole('button', { name: 'Änderungen dieser Zeile speichern' });
      const box = await check.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect((await row.boundingBox())?.height).toBeLessThanOrEqual(56);

      // Cancel discards: a second row is edited and thrown away
      const other = id(3);
      await editCell(page, other, 'Befund 3', 'verworfen');
      await page
        .locator(`tbody tr[data-row-id="${other}"]`)
        .getByRole('button', { name: 'Änderungen dieser Zeile verwerfen' })
        .click();
      await expect(page.locator(`tbody tr[data-row-id="${other}"]`).getByText('Befund 3')).toBeVisible();

      await row.getByRole('button', { name: 'Änderungen dieser Zeile speichern' }).click();
      await expect(row.getByText('Kronenpilz')).toBeVisible();
      await expect(row.getByText('Wurzelfäule')).toBeVisible();
      await expect(row.getByRole('button', { name: 'Änderungen dieser Zeile speichern' })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const runs = correctRuns();
      expect(runs).toHaveLength(before + 1);
      expect(runs.at(-1)).toMatchObject({ feature_id: feature, actor_kind: 'admin' });
      expect(correctRuns().filter((r) => r.feature_id === other)).toHaveLength(0);

      await page.goto(`/admin/projects/${PROJECT}/types/baum/${feature}`);
      await page.getByRole('tab', { name: 'Aktivität' }).click();
      const entry = page.getByTestId('activity-entry').filter({ hasText: 'Admin-Korrektur' });
      await expect(entry).toHaveCount(1);
      await expect(entry).toContainText(email);
      await entry.locator('summary').click();
      await expect(entry.getByTestId('activity-detail')).toContainText('Kronenpilz');
      await expect(entry.getByTestId('activity-detail')).toContainText('gross');
      await expect(entry.getByTestId('activity-detail')).toContainText('Wurzelfäule');
    });

    test('the stage cell is read-only in Bearbeitungsmodus, with a tooltip', async ({ page }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/types/baum`);
      await page.getByRole('switch', { name: 'Bearbeitungsmodus' }).click();
      const stage = page.locator(`tbody tr[data-row-id="${id(4)}"]`).getByTestId('stage-cell');
      await expect(stage).toHaveText('Kontrolliert');
      await expect(stage).toHaveAttribute('title', 'Die Stufe ändert sich über Aufgaben.');
      await stage.click();
      await expect(page.getByRole('combobox')).toHaveCount(0);
      await expect(page.getByRole('listbox')).toHaveCount(0);
    });
  });
}

test('the correct API: admin only, the stage and a stale row are refused, one call is one run', async ({
  playwright,
  baseURL,
}) => {
  const url = `/api/admin/p/${PROJECT}/features/${id(4)}/correct`;
  const anon = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect((await anon.post(url, { data: { values: { befund: 'x' } } })).status()).toBe(401);
  await anon.dispose();

  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await ctx.post('/api/auth/login', { data: { email: DEPLOYER, password: PASSWORD } });
  const headers = { 'sec-fetch-site': 'same-origin' };
  const before = correctRuns().length;
  const stage = await ctx.post(url, { data: { values: { stage: 'massnahme' } }, headers });
  expect(stage.status()).toBe(422);
  expect(JSON.stringify(await stage.json())).toContain('input.values.stage');
  const stale = await ctx.post(url, { data: { values: { befund: 'x' }, expected_seq: 999 }, headers });
  expect(stale.status()).toBe(409);
  expect(
    (await ctx.post(url.replace(id(4), id(99)), { data: { values: { befund: 'x' } }, headers })).status(),
  ).toBe(404);
  expect(correctRuns()).toHaveLength(before);
  const ok = await ctx.post(url, {
    data: { values: { befund: 'api', intern_notiz: 'a', hoehe_klasse: 'b' } },
    headers,
  });
  expect(ok.status(), await ok.text()).toBe(200);
  expect(correctRuns()).toHaveLength(before + 1);
  await ctx.dispose();
});
