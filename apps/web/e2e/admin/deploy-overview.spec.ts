import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse, stringify } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-360 (S4-18): the deploy overview that opens from "Veröffentlichen" (v3 `fork/+page.svelte:160-331`), from the
 * publish bar and from the builder toolbar: the diff per Objektart, the radio "belassen / verschieben" for running
 * Objekte, "verschieben nach / Werte verwerfen" for what a removal leaves behind, blockers with "Gehe zu", and the
 * confirm. Runs at phone (390x844) and desktop (1280x800) size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

test.use({ locale: 'de-DE' });

type Overlay = {
  order?: Record<string, string[]>;
  override?: Record<string, unknown>;
  add?: Record<string, unknown>;
  hide?: string[];
};

/** A project at version 1 (the golden overlay), signed-in context ready for draft edits. */
async function world(
  playwright: { request: { newContext(o: { baseURL: string }): Promise<APIRequestContext> } },
  baseURL: string,
  key: string,
) {
  expect(admin(['create-project', key, `Deploy ${key}`]).status).toBe(0);
  const email = `${key}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, key, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  expect((await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);
  const first = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  const deployed = await ctx.post(`/api/admin/p/${key}/deploy`, { data: first });
  expect(await deployed.json()).toMatchObject({ ok: true, version: 1 });
  return { ctx, email };
}

/** Edits the project's draft overlay the way the builder's save does (read, change, write at the revision). */
async function editDraft(ctx: APIRequestContext, key: string, edit: (o: Overlay) => void): Promise<void> {
  const draft = (await (await ctx.get(`/builder-api/${key}/draft`)).json()) as {
    overlay: string;
    revision: number;
  };
  const overlay = parse(draft.overlay) as Overlay;
  edit(overlay);
  const put = await ctx.put(`/builder-api/${key}/draft`, {
    data: { overlay: stringify(overlay), revision: draft.revision },
  });
  expect(put.status()).toBe(200);
}

/** Running (aktiv) baum Objekte holding a Patenschaft, plus one completed one. */
function seedBaeume(key: string): void {
  const db = openProjectDb(E2E_DATA_DIR, key);
  const put = db.prepare(
    `INSERT INTO features (id, type, config_version, properties, updated_seq, lifecycle, created_by, created_at, changed_at)
     VALUES (?, 'baum', 1, ?, ?, ?, 'seed', '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z')`,
  );
  db.transaction(() => {
    ['active', 'active', 'active', 'completed'].forEach((lifecycle, i) =>
      put.run(
        `00000000-0000-7000-8000-00000000036${i}`,
        JSON.stringify({ patenschaft: `Pate ${i}` }),
        i + 1,
        lifecycle,
      ),
    );
  });
  db.close();
}

/** Signs in and waits for the project list, so the next `goto` does not cut the login short. */
async function signIn(page: Page, email: string): Promise<void> {
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  test.describe(`${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('simple: the diff shows and one click publishes (no breaking change, no running Objekte)', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const key = `dov_simple_${size.name}`;
      const { ctx, email } = await world(playwright, baseURL ?? '', key);
      await editDraft(ctx, key, (o) => {
        o.override = { ...o.override, 'types.baum.label': { de: 'Baum neu', en: 'Tree new' } };
      });
      await signIn(page, email);
      await page.goto(`/admin/projects/${key}/roles`);

      await page.getByTestId('publish-bar').getByRole('button', { name: 'Veröffentlichen' }).click();
      const overview = page.getByTestId('deploy-overview');
      await expect(overview.getByText('In Produktion veröffentlichen').first()).toBeVisible();
      const group = overview.getByTestId('deploy-group').filter({ hasText: 'Baum' });
      await expect(group).toContainText('Keine tiefgreifenden Änderungen');
      await expect(group).toContainText('Objektart „Baum neu“ geändert');
      await expect(overview.getByRole('radio')).toHaveCount(0);
      expect(await noSideways(page)).toBe(true);

      await overview.getByRole('button', { name: 'Veröffentlichen' }).click();
      await expect(page.getByTestId('publish-bar')).toBeHidden();
      await expect(page.getByRole('status').filter({ hasText: 'Version 2 ist live.' }).first()).toBeVisible();
      await ctx.dispose();
    });

    test('order only (WP-411): the order line shows, but no Objekte are counted as affected', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const key = `dov_order_${size.name}`;
      const { ctx, email } = await world(playwright, baseURL ?? '', key);
      seedBaeume(key);
      await editDraft(ctx, key, (o) => {
        const template = parse(readFileSync(TEMPLATE, 'utf8')) as {
          types: { baum: { properties: Record<string, unknown> } };
        };
        const added = Object.keys(o.add ?? {})
          .filter((p) => /^types\.baum\.properties\.[^.]+$/.test(p))
          .map((p) => p.split('.')[3] as string);
        const keys = [...Object.keys(template.types.baum.properties), ...added];
        o.order = { ...o.order, 'types.baum.properties': keys.reverse() };
      });
      await signIn(page, email);
      await page.goto(`/admin/projects/${key}/roles`);
      await page.getByTestId('publish-bar').getByRole('button', { name: 'Veröffentlichen' }).click();
      const overview = page.getByTestId('deploy-overview');
      const group = overview.getByTestId('deploy-group').filter({ hasText: 'Baum' });
      await expect(group).toContainText('Objektart „Baum“: Reihenfolge der Eigenschaften geändert');
      await expect(group).not.toContainText('„properties“');
      await expect(overview.getByRole('radio')).toHaveCount(0); // a reorder touches no Objekt: no belassen oder verschieben
      await expect(group).toContainText('Keine tiefgreifenden Änderungen');
      await expect(group).not.toContainText('betroffen');
      await expect(group).not.toContainText(/\d+ Objekte( |$)/);
      expect(await noSideways(page)).toBe(true);
      await ctx.dispose();
    });

    test('a removed property with Objekten and running Objekte: choose a target, keep them, publish', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const key = `dov_move_${size.name}`;
      const { ctx, email } = await world(playwright, baseURL ?? '', key);
      seedBaeume(key);
      await editDraft(ctx, key, (o) => {
        delete o.add?.['types.baum.properties.patenschaft'];
        delete o.add?.['views.paten'];
      });
      await signIn(page, email);
      await page.goto(`/admin/projects/${key}/roles`);
      await page.getByTestId('publish-bar').getByRole('button', { name: 'Veröffentlichen' }).click();
      const overview = page.getByTestId('deploy-overview');
      const group = overview.getByTestId('deploy-group').filter({ hasText: 'Baum' });
      await expect(group).toContainText('Tiefgreifende Änderung');
      await expect(group).toContainText('Eigenschaft „Patenschaft“ entfernt');
      await expect(group).toContainText('4 Objekte betroffen');

      // Laufende Objekte: the radio with the counts, "verschieben" first.
      const radios = group.getByRole('radio');
      await expect(radios).toHaveCount(2);
      await expect(radios.nth(1)).toBeChecked();
      await expect(group.getByTestId('deploy-choice-counts')).toContainText('3 laufend');

      // The removed property still holds values: the confirm waits for a target or "Werte verwerfen".
      const confirm = overview.getByRole('button', { name: 'Veröffentlichen' });
      await expect(confirm).toBeDisabled();
      const select = group.getByTestId('deploy-remap').getByRole('combobox');
      await expect(select.locator('option').last()).toHaveText('Werte verwerfen');
      await select.selectOption({ label: 'Werte verwerfen' });
      await expect(confirm).toBeEnabled();
      expect(await noSideways(page)).toBe(true);

      // "belassen": the choice goes to the deploy as versions { baum: keep }.
      await radios.nth(0).check();
      const deployed = page.waitForRequest((r) => r.url().endsWith(`/builder-api/${key}/deploy`));
      await confirm.click();
      const body = (await deployed).postDataJSON() as {
        versions: unknown;
        mappings: Record<string, unknown>;
      };
      expect(body.versions).toEqual({ baum: 'keep' });
      expect(body.mappings['types.baum.properties.patenschaft']).toEqual({ discard: true });
      await expect(page.getByTestId('publish-bar')).toBeHidden();
      await ctx.dispose();
    });

    test('from the builder toolbar: blockers hold the confirm and "Gehe zu" selects the element', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const key = `dov_block_${size.name}`;
      const { ctx, email } = await world(playwright, baseURL ?? '', key);
      await editDraft(ctx, key, (o) => {
        o.override = { ...o.override, 'types.baum.properties.art.to': 'gibt_es_nicht' };
      });
      await signIn(page, email);
      await page.goto(`/admin/projects/${key}/types/baum/builder`);

      await page.getByTestId('builder-frame').getByTestId('deploy').click();
      const overview = page.getByTestId('deploy-overview');
      const blockers = overview.getByTestId('deploy-blockers');
      await expect(blockers).toContainText('Behebe zuerst:');
      await expect(overview.getByRole('button', { name: 'Veröffentlichen' })).toBeDisabled();

      await blockers.getByRole('button', { name: 'Gehe zu' }).first().click();
      await expect(overview).toBeHidden();
      await expect(page.getByTestId('field-pane')).toBeVisible();
      await expect(page).not.toHaveURL(/select=/);
      await ctx.dispose();
    });
  });
}
