import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-362 (S3-21): the Objekt's page, v3's `instances/[id]/+page.svelte`, at phone and desktop size. A row of the data
 * page opens it: header, Standort, Daten and Aktivität grouped by stage visit with a refused run, "Mehr laden", and the
 * way back to the table as it was left (search kept). Runs are written into the project database the way the run
 * transaction writes them (WP-362 keeps `runs.feature_id`).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'detailstadt';
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const ANNA = 'Anna Beispiel';
const FEATURE = '00000000-0000-7000-8000-00000000d001';
const OTHER = '00000000-0000-7000-8000-00000000d002';

test.use({ locale: 'de-DE' });

interface RunSeed {
  readonly id: string;
  readonly task: string;
  readonly actor: string;
  readonly at: string;
  readonly refused?: string;
  readonly observations?: readonly [string, unknown][];
}

function seed(anna: string, extra: number): void {
  const db = openProjectDb(E2E_DATA_DIR, PROJECT);
  const putFeature = db.prepare(
    `INSERT INTO features (id, type, config_version, properties, geometry, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, 'baum', 1, ?, ?, 7.1, 50.7, 1, 'active', ?, '2026-03-01T10:00:00.000Z', '2026-03-04T10:00:00.000Z')`,
  );
  putFeature.run(
    FEATURE,
    JSON.stringify({ stage: 'kontrolliert', befund: 'Eichenprozessionsspinner', hoehe_m: 12.5 }),
    JSON.stringify({ type: 'Point', coordinates: [7.1, 50.7] }),
    anna,
  );
  putFeature.run(OTHER, JSON.stringify({ stage: 'erfasst', befund: 'Linde' }), null, anna);
  const putRun = db.prepare(
    `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, refusal_code, seq, result, feature_id)
     VALUES (?, ?, 'participant', ?, 1, '{}', ?, ?, ?, ?, ?, ?)`,
  );
  const putObs = db.prepare(
    'INSERT INTO observations (seq, run_id, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?, ?)',
  );
  let seq = 0;
  const run = (r: RunSeed): void => {
    if (r.refused !== undefined) {
      putRun.run(
        r.id,
        r.actor,
        r.task,
        r.at,
        'rejected',
        'invalid_input',
        null,
        JSON.stringify({ refusal: { code: 'invalid_input', message: r.refused } }),
        FEATURE,
      );
      return;
    }
    const obs = r.observations ?? [];
    const from = seq + 1;
    putRun.run(
      r.id,
      r.actor,
      r.task,
      r.at,
      'accepted',
      null,
      from + obs.length - 1,
      JSON.stringify({ seq: { from, to: from + obs.length - 1 } }),
      FEATURE,
    );
    for (const [property, value] of obs)
      putObs.run(++seq, r.id, FEATURE, property, JSON.stringify(value), r.at);
  };
  db.transaction(() => {
    // enough older entries for a second page (they come first in the log, so the newest page holds the refused run)
    for (let i = 0; i < extra; i++)
      run({
        id: `e-more-${i}`,
        task: 'kontrolle',
        actor: anna,
        at: `2026-02-05T10:00:${String(i % 60).padStart(2, '0')}.000Z`,
        observations: [['hoehe_m', 5 + i]],
      });
    run({
      id: 'e-create',
      task: 'erfassen',
      actor: anna,
      at: '2026-03-01T10:00:00.000Z',
      observations: [
        ['$type', 'baum'],
        ['stage', 'erfasst'],
        ['befund', 'Eichenprozessionsspinner'],
        ['geometrie', { type: 'Point', coordinates: [7.1, 50.7] }],
      ],
    });
    run({
      id: 'e-move',
      task: 'kontrolle',
      actor: anna,
      at: '2026-03-02T10:00:00.000Z',
      observations: [['stage', 'kontrolliert']],
    });
    run({
      id: 'e-height',
      task: 'kontrolle',
      actor: anna,
      at: '2026-03-03T10:00:00.000Z',
      observations: [
        ['hoehe_m', 12.5],
        ['befund', 'Eichenprozessionsspinner'],
      ],
    });
    run({
      id: 'e-refused',
      task: 'kontrolle',
      actor: anna,
      at: '2026-03-04T10:00:00.000Z',
      refused: 'Befund muss sich ändern',
    });
  });
  db.close();
}

async function deploy(ctx: APIRequestContext): Promise<void> {
  const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  const res = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: file });
  expect(await res.json()).toMatchObject({ ok: true });
}

let admins = 0;
async function signIn(page: Page): Promise<void> {
  const email = `detail${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(180_000);
  expect(admin(['create-project', PROJECT, PROJECT]).status).toBe(0);
  createAdmin('detaildeploy@example.org');
  expect(admin(['add-membership', 'detaildeploy@example.org', PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect(
    (
      await ctx.post('/api/auth/login', { data: { email: 'detaildeploy@example.org', password: PASSWORD } })
    ).status(),
  ).toBe(200);
  await deploy(ctx);
  const added = await ctx.post(`/api/admin/p/${PROJECT}/participants`, {
    data: { name: ANNA, roles: [] },
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  expect(added.status(), await added.text()).toBe(201);
  const anna = ((await added.json()) as { id: string }).id;
  await ctx.dispose();
  seed(anna, 52);
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('a row opens the Objekt: header, Standort, Daten; back returns to the table as it was left', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/types/baum`);
      await page.getByRole('searchbox').fill('Eichen');
      await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(1);
      await page.locator('tbody tr[data-row-id]').first().getByText('Eichenprozessionsspinner').click();

      await expect(page).toHaveURL(new RegExp(`/admin/projects/${PROJECT}/types/baum/${FEATURE}$`));
      await expect(page.getByTestId('feature-title')).toBeVisible();
      const header = page.getByTestId('feature-header');
      await expect(header.getByText('Kontrolliert')).toBeVisible();
      await expect(header.getByText('aktiv')).toBeVisible();
      await expect(header.getByText(ANNA)).toBeVisible();
      // Daten: every property with its value; no Protokolle tab (owner question A3)
      await expect(page.getByRole('tab')).toHaveText(['Daten', 'Aktivität']);
      await expect(page.getByTestId('data-row-befund')).toContainText('Eichenprozessionsspinner');
      await expect(page.getByTestId('data-row-hoehe_m')).toContainText('12,5');
      // Standort: the shape on the project's base layer, the coordinates below
      await expect(page.getByTestId('feature-location').locator('svg[role=img]')).toBeVisible();
      await expect(page.getByTestId('feature-coordinates')).toHaveText('50.70000, 7.10000');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await page.getByTestId('feature-back').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${PROJECT}/types/baum$`));
      await expect(page.getByRole('searchbox')).toHaveValue('Eichen');
      await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(1);
    });

    test('Aktivität: stage visits newest first, a refused run with its reason, "Mehr laden" pages', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/types/baum/${FEATURE}`);
      await page.getByRole('tab', { name: 'Aktivität' }).click();
      const feed = page.getByTestId('feature-activity');
      await expect(feed).toBeVisible();
      // the refused run is the newest entry of the newest visit; its reason is in its detail
      await expect(page.getByTestId('activity-refused')).toHaveText('Abgelehnt');
      await page
        .getByTestId('activity-entry')
        .filter({ has: page.getByTestId('activity-refused') })
        .locator('summary')
        .click();
      await expect(page.getByTestId('activity-refusal')).toHaveText('Befund muss sich ändern');
      // 50 runs a page: the button is there and pages in the rest
      await expect(page.getByTestId('activity-more')).toBeVisible();
      const before = await page.getByTestId('activity-entry').count();
      await page.getByTestId('activity-more').click();
      await expect(page.getByTestId('activity-more')).toHaveCount(0);
      expect(await page.getByTestId('activity-entry').count()).toBeGreaterThan(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}

test('the history API: admin only, newest first, 50 a page with a cursor', async ({
  playwright,
  baseURL,
}) => {
  const anon = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect((await anon.get(`/api/admin/p/${PROJECT}/features/${FEATURE}/history`)).status()).toBe(401);
  await anon.dispose();
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await ctx.post('/api/auth/login', { data: { email: 'detaildeploy@example.org', password: PASSWORD } });
  const page = (await (await ctx.get(`/api/admin/p/${PROJECT}/features/${FEATURE}/history`)).json()) as {
    runs: { id: string }[];
    next: string | null;
  };
  expect(page.runs).toHaveLength(50);
  expect(page.next).not.toBeNull();
  expect(page.runs[0]?.id).toBe('e-refused'); // newest first
  await ctx.dispose();
});
