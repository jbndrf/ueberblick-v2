import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-1048: the admin shell pads its content; InstancePage, ProtokollView and FeatureDetail no longer add their own
 * padding, so their first content element sits at the same left edge as the Versionen page, at phone and desktop size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'paddingstadt';
const FEATURE = '00000000-0000-7000-8000-00000000f048';
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(180_000);
  expect(admin(['create-project', PROJECT, PROJECT]).status).toBe(0);
  createAdmin('paddingdeploy@example.org');
  expect(admin(['add-membership', 'paddingdeploy@example.org', PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'paddingdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  expect(await (await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: file })).json()).toMatchObject({
    ok: true,
  });
  await ctx.dispose();
  const db = openProjectDb(E2E_DATA_DIR, PROJECT);
  db.prepare(
    `INSERT INTO features (id, type, config_version, properties, anchor_lon, anchor_lat, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, 'baum', 1, ?, 7.1, 50.7, 1, 'active', 'x', '2026-03-01T10:00:00.000Z', '2026-03-04T10:00:00.000Z')`,
  ).run(FEATURE, JSON.stringify({ stage: 'erfasst' }));
  db.prepare(
    `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, refusal_code, seq, result, feature_id)
     VALUES ('pad-run', 'x', 'participant', 'kontrolle', 1, '{}', '2026-03-03T10:00:00.000Z', 'accepted', NULL, 1, ?, ?)`,
  ).run(JSON.stringify({ seq: { from: 1, to: 1 } }), FEATURE);
  db.close();
});

async function left(page: Page, url: string, selector: string): Promise<number> {
  await page.goto(url);
  const box = await page.locator(selector).first().boundingBox();
  expect(box).not.toBeNull();
  return box?.x ?? -1;
}

for (const size of SIZES) {
  test(`${size.name}: instance, Protokoll and feature pages sit at the shell padding like Versionen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const email = `padding-${size.name}@example.org`;
    createAdmin(email);
    expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
    await signInAs(page, email);
    await expect(page).toHaveURL(/\/admin\/projects/);
    const base = `/admin/projects/${PROJECT}`;
    const versionen = await left(page, `${base}/versions`, 'h1');
    const feature = await left(page, `${base}/types/baum/${FEATURE}`, '[data-testid="feature-title"]');
    const protokoll = await left(
      page,
      `${base}/types/baum/${FEATURE}/protokoll/pad-run`,
      '[data-testid="protokoll-back"]',
    );
    const instance = await left(page, '/admin/instance', '[data-testid="instance-page"] h1');
    // max-width differs per page (centred), so the edges are equal only where the shell padding is the limit
    if (size.name === 'phone') {
      expect(feature).toBe(versionen);
      expect(protokoll).toBe(versionen);
      expect(instance).toBe(versionen);
    }
    // the page's own root adds no padding at either size
    for (const [url, selector] of [
      ['/admin/instance', '[data-testid="instance-page"]'],
      [`${base}/types/baum/${FEATURE}/protokoll/pad-run`, '[data-testid="protokoll"]'],
    ]) {
      await page.goto(url ?? '');
      const pad = await page.locator(selector ?? '').evaluate((el) => getComputedStyle(el).paddingLeft);
      expect(pad).toBe('0px');
    }
  });
}
