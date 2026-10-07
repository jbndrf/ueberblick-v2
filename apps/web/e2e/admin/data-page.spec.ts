import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { stubTileProxy } from '../support/tile-proxy-stub';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-347 (S3-18): the data page of one Objektart, v3's `workflows/[workflowId]/+page.svelte`, at phone and desktop
 * size. Rows come from the admin feature list API (WP-313): search, sort, a column filter and paging are the server's.
 * A second project holds 60 000 Objekte: its first page must come up fast (R14).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const SMALL = 'datastadt';
const BIG = 'bigstadt';
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const ANNA = 'Anna Beispiel';

test.use({ locale: 'de-DE' });

interface Seed {
  readonly lifecycle: string;
  readonly createdBy: string;
  readonly stage: string;
  readonly befund: string;
}

function insertFeatures(project: string, rows: readonly Seed[], geometry: boolean): void {
  const db = openProjectDb(E2E_DATA_DIR, project);
  const put = db.prepare(
    `INSERT INTO features (id, type, config_version, properties, geometry, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, 'baum', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    rows.forEach((r, i) => {
      const lon = 7 + (i % 100) / 1000;
      const lat = 50 + (i % 77) / 1000;
      const day = String(1 + (i % 28)).padStart(2, '0');
      put.run(
        `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
        JSON.stringify({ stage: r.stage, befund: r.befund, hoehe_m: 5 + (i % 30) }),
        geometry ? JSON.stringify({ type: 'Point', coordinates: [lon, lat] }) : null,
        lon,
        lat,
        i + 1,
        r.lifecycle,
        r.createdBy,
        `2026-01-${day}T08:00:00.000Z`,
        `2026-02-${day}T08:00:00.000Z`,
      );
    });
  });
  db.close();
}

async function deploy(ctx: APIRequestContext, project: string): Promise<void> {
  const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  const res = await ctx.post(`/api/admin/p/${project}/deploy`, { data: file });
  expect(await res.json()).toMatchObject({ ok: true });
}

let admins = 0;
async function signIn(page: Page): Promise<void> {
  const email = `data${(admins += 1)}@example.org`;
  createAdmin(email);
  for (const p of [SMALL, BIG]) expect(admin(['add-membership', email, p, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(240_000);
  for (const p of [SMALL, BIG]) expect(admin(['create-project', p, p]).status).toBe(0);
  createAdmin('datadeploy@example.org');
  for (const p of [SMALL, BIG])
    expect(admin(['add-membership', 'datadeploy@example.org', p, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect(
    (
      await ctx.post('/api/auth/login', { data: { email: 'datadeploy@example.org', password: PASSWORD } })
    ).status(),
  ).toBe(200);
  await deploy(ctx, SMALL);
  await deploy(ctx, BIG);
  const added = await ctx.post(`/api/admin/p/${SMALL}/participants`, {
    data: { name: ANNA, roles: [] },
    headers: { 'sec-fetch-site': 'same-origin' }, // a change must come from the admin app
  });
  expect(added.status(), await added.text()).toBe(201);
  const anna = ((await added.json()) as { id: string }).id;
  await ctx.dispose();

  const small: Seed[] = Array.from({ length: 8 }, (_, i) => ({
    lifecycle: i === 7 ? 'deleted' : i === 6 ? 'completed' : 'active',
    createdBy: i % 2 === 0 ? anna : 'someone-else',
    stage: i % 2 === 0 ? 'erfasst' : 'kontrolliert',
    befund: `Befund ${String.fromCharCode(65 + i)}`,
  }));
  insertFeatures(SMALL, small, true);
  const stages = ['erfasst', 'kontrolliert', 'massnahme'];
  insertFeatures(
    BIG,
    Array.from({ length: 60_000 }, (_, i) => ({
      lifecycle: i % 50 === 0 ? 'deleted' : 'active',
      createdBy: `user${i % 25}`,
      stage: stages[i % 3] as string,
      befund: `Pilz ${i}`,
    })),
    false,
  );
});

const rowIds = (page: Page): Promise<string[]> =>
  page
    .locator('tbody tr[data-row-id]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-row-id') ?? ''));

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('the table lists the Objekte with v3 columns; search, sort and a column filter ask the server', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${SMALL}/types/baum`);

      await expect(page.getByRole('heading', { level: 1, name: 'Baum' })).toBeVisible();
      for (const h of ['Status', 'Stufe', 'Erstellt von', 'Standort', 'Befund', 'Erstellt'])
        await expect(page.getByRole('columnheader', { name: new RegExp(h) }).first()).toBeAttached();
      // 8 Objekte, one deleted: hidden by default
      await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(7);
      await expect(page.getByText(ANNA).first()).toBeVisible();
      await expect(page.getByText('Erfasst').first()).toBeVisible();
      await expect(page.getByText('abgeschlossen')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // search
      await page.getByRole('searchbox').fill('Befund C');
      await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(1);
      await page.getByRole('searchbox').fill('');
      await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(7);

      // sort by Befund: descending after two clicks
      await page.getByRole('button', { name: 'Befund', exact: true }).click();
      await page.getByRole('button', { name: 'Befund', exact: true }).click();
      await expect.poll(async () => (await rowIds(page))[0]).toContain('000000000006');

      // column filter: the deleted ones can be asked for in the Status filter
      await page.getByRole('button', { name: 'Status filtern' }).click();
      await page.getByRole('option', { name: /gelöscht/ }).click();
      await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(1);
      await expect(page.getByText('gelöscht').last()).toBeVisible();
    });

    test('hovering or focusing the location shows the shape; rows are no links yet; Builder opens the builder', async ({
      page,
    }) => {
      const csp: string[] = [];
      page.on('console', (m) => {
        if (/content security policy/i.test(m.text())) csp.push(m.text());
      });
      const tiles = await stubTileProxy(page);
      await signIn(page);
      await page.goto(`/admin/projects/${SMALL}/types/baum`);
      await expect(page.locator('tbody tr[data-row-id]').first()).toBeVisible();
      expect(tiles).toEqual([]); // lazy: no tile request before the card opens
      expect(await page.locator('tbody a').count()).toBe(0);
      expect(await page.locator('img[src*="/api/p/"]').count()).toBe(0); // lazy: nothing before the card opens

      await page
        .locator('tbody tr[data-row-id]')
        .first()
        .getByRole('button', { name: /50\.0\d+, 7\.0\d+/ })
        .focus();
      await expect(page.locator('svg[role=img]')).toBeVisible();
      // the project's base layer (OSM preset of the golden template) lies under the shape, read through the tile proxy
      await expect(page.locator('img[src*="/api/p/"]').first()).toBeAttached();
      await expect.poll(() => tiles.length).toBeGreaterThan(0);
      expect(csp).toEqual([]);

      await page.keyboard.press('Escape'); // closes the hover card
      await expect(page.locator('svg[role=img]')).toHaveCount(0);
      await page.getByRole('link', { name: 'Builder' }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${SMALL}/types/baum/builder$`));
    });
  });
}

test('desktop: the sidebar entry of an Objektart opens its data page', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await signIn(page);
  await page.goto(`/admin/projects/${SMALL}/participants`);
  await page.getByTestId('group-types').getByRole('link', { name: 'Baum', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/projects/${SMALL}/types/baum$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Baum' })).toBeVisible();
});

test('R14: the first page of a 60 000-Objekte project comes up fast, and scrolling loads the next page', async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await signIn(page);
  const lists: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/features?')) lists.push(r.url());
  });
  const t0 = Date.now();
  await page.goto(`/admin/projects/${BIG}/types/baum`);
  // the budget is the timeout: the first page must be on screen within 5 s even on a loaded machine
  await expect(page.locator('tbody tr[data-row-id]').first()).toBeVisible({ timeout: 5000 });
  const firstPageMs = Date.now() - t0;
  console.log(`data page, 60k Objekte: first page visible after ${firstPageMs} ms`);
  // never more than a window of rows in the DOM
  expect(await page.locator('tbody tr[data-row-id]').count()).toBeLessThanOrEqual(60);
  await page.locator('[data-scroll]').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => lists.length).toBeGreaterThan(1);
  expect(lists.some((u) => u.includes('cursor='))).toBe(true);
});
