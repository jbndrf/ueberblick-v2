import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-372 (owner A3): every past run opens from Aktivität as a read-only filled form, "Protokoll vom <Datum>, <Autor>",
 * at phone and desktop size. Runs are written into the project database the way the run transaction writes them.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'protokollstadt';
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const ANNA = 'Anna Beispiel';
const FEATURE = '00000000-0000-7000-8000-00000000e001';
const MASSNAHME = '00000000-0000-7000-8000-00000000e002';

test.use({ locale: 'de-DE' });

function seed(anna: string): void {
  const db = openProjectDb(E2E_DATA_DIR, PROJECT);
  db.prepare(
    `INSERT INTO features (id, type, config_version, properties, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, 'baum', 1, ?, 7.1, 50.7, 1, 'active', ?, '2026-03-01T10:00:00.000Z', '2026-03-04T10:00:00.000Z')`,
  ).run(FEATURE, JSON.stringify({ stage: 'erfasst', befund: 'Kronenpflege', hoehe_m: 12.5 }), anna);
  const putRun = db.prepare(
    `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, refusal_code, seq, result, feature_id)
     VALUES (?, ?, 'participant', 'kontrolle', 1, '{}', ?, ?, ?, ?, ?, ?)`,
  );
  const putObs = db.prepare(
    'INSERT INTO observations (seq, run_id, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    const obs: [string, unknown][] = [
      ['vitalitaet', 'v2'],
      ['befund', 'Kronenpflege'],
      ['hoehe_m', 12.5],
    ];
    putRun.run(
      'p-check',
      anna,
      '2026-03-03T10:00:00.000Z',
      'accepted',
      null,
      3,
      JSON.stringify({ seq: { from: 1, to: 3 } }),
      FEATURE,
    );
    obs.forEach(([p, v], i) =>
      putObs.run(i + 1, 'p-check', FEATURE, p, JSON.stringify(v), '2026-03-03T10:00:00.000Z'),
    );
    putRun.run(
      'p-refused',
      anna,
      '2026-03-04T10:00:00.000Z',
      'rejected',
      'invalid_input',
      null,
      JSON.stringify({ refusal: { code: 'invalid_input', message: 'Befund muss sich ändern' } }),
      FEATURE,
    );
  });
  // WP-1076: a Maßnahme whose run wrote the reference `baum`; its Protokoll names the tree, never shows the UUID.
  db.prepare(
    `INSERT INTO features (id, type, config_version, properties, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, 'massnahme', 1, ?, 7.1, 50.7, 1, 'active', ?, '2026-03-01T10:00:00.000Z', '2026-03-04T10:00:00.000Z')`,
  ).run(MASSNAHME, JSON.stringify({ baum: FEATURE, art: 'schnitt' }), anna);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, refusal_code, seq, result, feature_id)
       VALUES ('m-run', ?, 'participant', 'altlast', 1, '{}', '2026-03-03T11:00:00.000Z', 'accepted', NULL, 5, ?, ?)`,
    ).run(anna, JSON.stringify({ seq: { from: 4, to: 5 } }), MASSNAHME);
    const obs = db.prepare(
      'INSERT INTO observations (seq, run_id, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?, ?)',
    );
    obs.run(4, 'm-run', MASSNAHME, 'baum', JSON.stringify(FEATURE), '2026-03-03T11:00:00.000Z');
    obs.run(5, 'm-run', MASSNAHME, 'art', JSON.stringify('schnitt'), '2026-03-03T11:00:00.000Z');
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
  const email = `protokoll${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(180_000);
  expect(admin(['create-project', PROJECT, PROJECT]).status).toBe(0);
  createAdmin('protokolldeploy@example.org');
  expect(admin(['add-membership', 'protokolldeploy@example.org', PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect(
    (
      await ctx.post('/api/auth/login', {
        data: { email: 'protokolldeploy@example.org', password: PASSWORD },
      })
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
  seed(anna);
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('Aktivität opens the run as a read-only filled form; back returns to Aktivität; print drops the shell', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/types/baum/${FEATURE}`);
      await page.getByRole('tab', { name: 'Aktivität' }).click();
      // the refused run has no Protokoll, the accepted one has
      await expect(page.getByTestId('activity-protokoll')).toHaveCount(1);
      await page.getByTestId('activity-protokoll').click();

      await expect(page).toHaveURL(new RegExp(`/${FEATURE}/protokoll/p-check$`));
      await expect(page.getByTestId('protokoll-title')).toHaveText(/^Protokoll vom .*2026.*, Anna Beispiel$/);
      await expect(page.getByTestId('protokoll-task')).toHaveText('Regelkontrolle');
      const form = page.getByTestId('protokoll-form');
      const befund = form.getByLabel(/Befund/);
      await expect(befund).toHaveValue('Kronenpflege');
      await expect(befund).toHaveAttribute('aria-readonly', 'true');
      await expect(befund).toHaveJSProperty('readOnly', true);
      await expect(form.getByLabel(/Höhe \(m\)/)).toHaveValue('12.5');
      await expect(form.getByRole('button', { name: /Absenden/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // print: the browser's print-to-PDF; the shell (sidebar, top bar) and the buttons are left out
      await page.evaluate(() => {
        (window as unknown as { printed: number }).printed = 0;
        window.print = () => ((window as unknown as { printed: number }).printed += 1);
      });
      await page.getByTestId('protokoll-print').click();
      expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
      await page.emulateMedia({ media: 'print' });
      await expect(page.getByTestId('protokoll-print')).toBeHidden();
      await expect(page.getByTestId('protokoll-back')).toBeHidden();
      await expect(page.getByTestId('protokoll-title')).toBeVisible();
      await expect(form.getByLabel(/Befund/)).toBeVisible();
      await page.emulateMedia({ media: 'screen' });

      await page.getByTestId('protokoll-back').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${PROJECT}/types/baum/${FEATURE}$`));
      await expect(page.getByTestId('feature-title')).toBeVisible();
    });

    test('the Protokoll of a Maßnahme names the referenced Baum, never its UUID (WP-1076)', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/types/massnahme/${MASSNAHME}/protokoll/m-run`);
      const baum = page.getByTestId('protokoll-form').getByLabel(/^Baum/);
      await expect(baum).toBeVisible();
      const shown = await baum.inputValue();
      expect(shown).not.toBe('');
      expect(shown).not.toContain(FEATURE);
      expect(shown).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}

test('the Protokoll API: admin only; a refused run and an unknown run are 404', async ({
  playwright,
  baseURL,
}) => {
  const url = (run: string) => `/api/admin/p/${PROJECT}/features/${FEATURE}/runs/${run}`;
  const anon = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect((await anon.get(url('p-check'))).status()).toBe(401);
  await anon.dispose();
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await ctx.post('/api/auth/login', { data: { email: 'protokolldeploy@example.org', password: PASSWORD } });
  const res = await ctx.get(url('p-check'));
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    run: { id: string; configVersion: number };
    values: { befund: string };
  };
  expect(body.run).toMatchObject({ id: 'p-check', configVersion: 1 });
  expect(body.values.befund).toBe('Kronenpflege');
  expect((await ctx.get(url('p-refused'))).status()).toBe(404);
  expect((await ctx.get(url('nope'))).status()).toBe(404);
  await ctx.dispose();
});
