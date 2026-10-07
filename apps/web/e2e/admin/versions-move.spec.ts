import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { parse, stringify } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-368 (owner P3): "Auf aktuelle Version verschieben" on the Versionen page. A deploy with "belassen" pins the
 * running Objekte to the old version; the page then shows how many are pinned, and the button moves them with the
 * deploy overview's "verschieben nach / Werte verwerfen" rows until the count is 0. Phone (390x844) and desktop
 * (1280x800).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROPERTY = 'types.baum.properties.patenschaft';
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

test.use({ locale: 'de-DE' });

type Overlay = { add?: Record<string, unknown> };

const pinnedCount = (key: string): number => {
  const db = openProjectDb(E2E_DATA_DIR, key);
  const n =
    db.prepare<{ n: number }>('SELECT count(*) AS n FROM features WHERE pinned_version IS NOT NULL').get()
      ?.n ?? 0;
  db.close();
  return n;
};

/** A project at version 1 with three running Objekte and one completed one (all through runs), each holding a Patenschaft. */
async function world(
  playwright: { request: { newContext(o: { baseURL: string }): Promise<APIRequestContext> } },
  baseURL: string,
  key: string,
) {
  expect(admin(['create-project', key, `Move ${key}`]).status).toBe(0);
  const email = `${key}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, key, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  expect((await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);
  const first = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  const deployed = await ctx.post(`/api/admin/p/${key}/deploy`, { data: first });
  expect(await deployed.json()).toMatchObject({ ok: true, version: 1 });
  // Real runs (`$create`), so the Objekte fold like production and a pin of them is written.
  for (const i of [0, 1, 2, 3]) {
    const made = await ctx.post(`/api/admin/p/${key}/features`, {
      data: {
        type: 'baum',
        values: {
          geometrie: { type: 'Point', coordinates: [9.1 + i / 100, 48.5] },
          patenschaft: `Pate ${i}`,
        },
      },
    });
    expect(made.status(), await made.text()).toBe(201);
    if (i === 3) {
      const { id } = (await made.json()) as { id: string };
      const done = await ctx.post(`/api/admin/p/${key}/features/${id}/lifecycle`, {
        data: { state: 'completed' },
      });
      expect(done.status()).toBe(200);
    }
  }
  return { ctx, email };
}

/** Removes the Patenschaft from the draft and deploys it with "belassen" for baum: the running Objekte stay on v1. */
async function deployKeeping(ctx: APIRequestContext, key: string): Promise<void> {
  const draft = (await (await ctx.get(`/builder-api/${key}/draft`)).json()) as {
    overlay: string;
    revision: number;
  };
  const overlay = parse(draft.overlay) as Overlay;
  delete overlay.add?.[PROPERTY];
  delete overlay.add?.['views.paten'];
  const put = await ctx.put(`/builder-api/${key}/draft`, {
    data: { overlay: stringify(overlay), revision: draft.revision },
  });
  expect(put.status()).toBe(200);
  const saved = (await put.json()) as { revision: number };
  const res = await ctx.post(`/builder-api/${key}/deploy`, {
    data: {
      revision: saved.revision,
      mappings: { [PROPERTY]: { discard: true }, 'views.paten': { discard: true } },
      versions: { baum: 'keep' },
    },
  });
  const outcome = (await res.json()) as unknown;
  expect(JSON.stringify(outcome)).toContain('"ok":true');
}

async function signIn(page: Page, email: string): Promise<void> {
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  test.describe(`${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('pin by deploying "belassen", then move manually: the count goes to 0', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const key = `vmove_${size.name}`;
      const { ctx, email } = await world(playwright, baseURL ?? '', key);
      await deployKeeping(ctx, key);
      expect(pinnedCount(key)).toBe(3);

      await signIn(page, email);
      await page.goto(`/admin/projects/${key}/versions`);
      const row = page.locator('[data-version="1"]');
      await expect(row.getByTestId('pinned-count')).toHaveText('3 Objekte noch auf dieser Version');
      // the deployed version and versions without pins have no button
      await expect(
        page.locator('[data-version="2"]').getByRole('button', { name: 'Auf aktuelle Version verschieben' }),
      ).toHaveCount(0);

      await row.getByRole('button', { name: 'Auf aktuelle Version verschieben' }).click();
      const dialog = page.getByTestId('pin-move');
      await expect(dialog.getByTestId('pin-move-summary')).toContainText(
        '3 Objekte wechseln von Version 1 auf Version 2.',
      );
      await expect(dialog.getByTestId('deploy-group')).toContainText('Eigenschaft „Patenschaft“ entfernt');
      await expect(dialog.getByTestId('deploy-group')).toContainText('3 Objekte betroffen');
      expect(await noSideways(page)).toBe(true);

      // the pinned Objekte hold values of the removed property: the confirm waits for an answer
      const confirm = dialog.getByRole('button', { name: 'Verschieben' });
      await expect(confirm).toBeDisabled();
      await dialog
        .getByTestId('deploy-remap')
        .getByRole('combobox')
        .selectOption({ label: 'Werte verwerfen' });
      await expect(confirm).toBeEnabled();
      await confirm.click();

      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('pinned-count')).toHaveCount(0);
      expect(pinnedCount(key)).toBe(0);
      expect(await noSideways(page)).toBe(true);
      await ctx.dispose();
    });
  });
}

/**
 * The template upgrade offer (a3.engine-new-template-upgrade). The golden Baumkataster is published under another key
 * (`baumup`), so publishing its 1.1.0 touches no other spec's project.
 */
function publishBaumup(tpl: string, version: '1.0.0' | '1.1.0'): void {
  const dir = join(tmpdir(), 'baumup-e2e');
  mkdirSync(dir, { recursive: true });
  const src = parse(readFileSync(goldenFile(`templates/baumkataster/${version}.yaml`), 'utf8')) as {
    template: { key: string };
  };
  src.template.key = tpl;
  const file = join(dir, `${tpl}-${version}.yaml`);
  writeFileSync(file, stringify(src));
  const r = admin(['publish-template', file]);
  if (r.status !== 0) expect(r.out + String(r.status)).toMatch(/exist|already|published/i);
}

for (const size of SIZES) {
  test.describe(`upgrade offer, ${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('a newer template version is offered; "Aktualisieren und veröffentlichen" deploys it', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const key = `vupgrade_${size.name}`;
      const tpl = `baumup${size.name}`;
      publishBaumup(tpl, '1.0.0');
      expect(admin(['create-project', key, `Upgrade ${key}`]).status).toBe(0);
      const email = `${key}@example.org`;
      createAdmin(email);
      expect(admin(['add-membership', email, key, 'verwaltung']).status).toBe(0);
      const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
      expect((await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);
      const overlay = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
      overlay['extends'] = `${tpl}@1`;
      const deployed = await ctx.post(`/api/admin/p/${key}/deploy`, { data: overlay });
      expect(await deployed.json()).toMatchObject({ ok: true, version: 1 });
      // the offer is read from the working draft, which starts on the version deployed now
      expect((await ctx.get(`/builder-api/${key}/draft`)).status()).toBe(200);
      await ctx.dispose();

      await signIn(page, email);
      await page.goto(`/admin/projects/${key}/versions`);
      await expect(page.getByTestId('upgrade-offer')).toHaveCount(0);

      publishBaumup(tpl, '1.1.0');
      await page.goto(`/admin/projects/${key}/versions`);
      const offer = page.getByTestId('upgrade-offer');
      await expect(offer).toContainText(`Vorlage ${tpl}: Version 1.1.0 verfügbar`);
      expect(await noSideways(page)).toBe(true);
      const run = offer.getByRole('button', { name: 'Aktualisieren und veröffentlichen' });
      await expect(run).toBeEnabled();
      await run.click();
      await expect(offer).toHaveCount(0);
      await expect(page.locator('[data-version="2"]')).toBeVisible();
    });
  });
}
