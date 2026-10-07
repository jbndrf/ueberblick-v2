import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-463 (WP-453): the Tabellen grid shows a reference cell by the entry's name (v3 custom-tables grid), never its id,
 * at phone and desktop size. A second table `pflanzung` references the table `baumart` (one entry, and a list of two).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const ART_A = '00000000-0000-7000-8000-0000000000a1';
const ART_B = '00000000-0000-7000-8000-0000000000a2';

test.use({ locale: 'de-DE' });

async function deploy(ctx: APIRequestContext, project: string): Promise<void> {
  const file = parse(readFileSync(OVERLAY, 'utf8')) as { add: Record<string, unknown> };
  file.add['types.pflanzung'] = {
    label: { de: 'Pflanzung', en: 'Planting' },
    permissions: { see: '$all', create: ['verwaltung'], write: ['verwaltung'] },
    properties: {
      titel: { type: 'text', required: true, label: { de: 'Titel', en: 'Title' } },
      art: { type: 'reference', to: 'baumart', label: { de: 'Art', en: 'Species' } },
      arten: {
        type: 'reference',
        to: 'baumart',
        options: { cardinality: 'many' },
        label: { de: 'Weitere Arten', en: 'More species' },
      },
    },
  };
  const res = await ctx.post(`/api/admin/p/${project}/deploy`, { data: file });
  expect(await res.json()).toMatchObject({ ok: true });
}

function seed(project: string): void {
  const db = openProjectDb(E2E_DATA_DIR, project);
  const put = db.prepare(
    `INSERT INTO features (id, type, config_version, properties, geometry, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, ?, 1, ?, NULL, NULL, NULL, ?, 'active', 'someone', '2026-01-01T08:00:00.000Z', '2026-02-01T08:00:00.000Z')`,
  );
  put.run(ART_A, 'baumart', JSON.stringify({ name_de: 'Schwarzerle' }), 1);
  put.run(ART_B, 'baumart', JSON.stringify({ name_de: 'Hängebirke' }), 2);
  put.run(
    '00000000-0000-7000-8000-0000000000c1',
    'pflanzung',
    JSON.stringify({ titel: 'Pflanzung Nord', art: ART_A, arten: [ART_A, ART_B] }),
    3,
  );
  db.close();
}

let admins = 0;
async function signIn(page: Page, project: string): Promise<void> {
  const email = `refnames${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, project, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(180_000);
  createAdmin('refnamesdeploy@example.org');
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  for (const name of Object.keys(VIEWPORTS)) {
    const p = `refnames_${name}`;
    expect(admin(['create-project', p, p]).status).toBe(0);
    expect(admin(['add-membership', 'refnamesdeploy@example.org', p, 'verwaltung']).status).toBe(0);
  }
  expect(
    (
      await ctx.post('/api/auth/login', {
        data: { email: 'refnamesdeploy@example.org', password: PASSWORD },
      })
    ).status(),
  ).toBe(200);
  for (const name of Object.keys(VIEWPORTS)) {
    await deploy(ctx, `refnames_${name}`);
    seed(`refnames_${name}`);
  }
  await ctx.dispose();
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('a reference cell shows the entry name (one and many), never the id', async ({ page }) => {
      const project = `refnames_${name}`;
      await signIn(page, project);
      await page.goto(`/admin/projects/${project}/tables/pflanzung`);
      const row = page.locator('tbody tr[data-row-id]').filter({ hasText: 'Pflanzung Nord' });
      await expect(row).toBeVisible();
      await expect(row.getByText('Schwarzerle').first()).toBeVisible();
      await expect(row).toContainText('Hängebirke');
      await expect(row).not.toContainText(ART_A);
      await expect(row).not.toContainText(ART_B);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}
