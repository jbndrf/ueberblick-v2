import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { openProjectDbFile } from '@ueberblick/server';
import { parse, stringify } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-373 (A-031 item 4, A-034, owner V1-V4): v3's "Vorschau-Logins" in the deploy overview. The admin copies the login of a
 * role, signs in with it on a phone, creates an Objekt in the preview, publishes a change, and the Objekt is still in
 * the preview (it is carried over, not discarded), the same link still signs in. Phone (390x844) and desktop (1280x800).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

test.use({ locale: 'de-DE' });

type Overlay = { override?: Record<string, unknown>; add?: Record<string, unknown>; hide?: string[] };

async function world(
  playwright: { request: { newContext(o: { baseURL: string }): Promise<APIRequestContext> } },
  baseURL: string,
  key: string,
) {
  expect(admin(['create-project', key, `Vorschau ${key}`]).status).toBe(0);
  const email = `${key}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, key, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  expect((await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);
  const first = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  expect(await (await ctx.post(`/api/admin/p/${key}/deploy`, { data: first })).json()).toMatchObject({
    ok: true,
    version: 1,
  });
  return { ctx, email };
}

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

interface PreviewBody {
  status: string;
  logins: { role: string | null; token: string }[];
}

test.describe('Vorschau-Logins', () => {
  for (const size of SIZES) {
    test(`copy a login, sign in, create an Objekt, publish a change: the Objekt stays in the preview (${size.name})`, async ({
      page,
      browser,
      playwright,
      baseURL,
      context,
    }) => {
      const key = `vlog_${size.name}`;
      const { ctx, email } = await world(playwright, baseURL ?? '', key);
      await editDraft(ctx, key, (o) => {
        o.override = { ...o.override, 'types.baum.label': { de: 'Baum neu', en: 'Tree new' } };
      });
      // the preview follows the draft after the debounce: wait for its logins
      await expect
        .poll(
          async () =>
            ((await (await ctx.get(`/builder-api/${key}/preview`)).json()) as PreviewBody).logins.length,
        )
        .toBeGreaterThan(0);

      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize(size.viewport);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto(`/admin/projects/${key}/roles`);
      await page.getByTestId('publish-bar').getByRole('button', { name: 'Veröffentlichen' }).click();
      const overview = page.getByTestId('deploy-overview');
      const card = overview.getByTestId('preview-logins');
      await expect(card.getByRole('heading', { name: 'Vorschau-Logins' })).toBeVisible();
      const row = card.getByTestId('preview-login').filter({ hasText: 'Verwaltung' });
      await expect(row).toBeVisible();
      await expect(card.getByTestId('preview-login').filter({ hasText: 'Keine Rolle' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // copy: the button says "Kopiert!" and the clipboard holds the login link
      await row.getByRole('button', { name: 'Link kopieren' }).click();
      await expect(row.getByRole('button', { name: 'Kopiert!' })).toBeVisible();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      expect(link).toMatch(/\/login\?token=/);

      // sign in with it, as that role, on a fresh device
      const phone = await browser.newContext({
        viewport: size.viewport,
        locale: 'de-DE',
        baseURL: baseURL ?? '',
      });
      const user = await phone.newPage();
      await user.goto(link);
      await expect(user).toHaveURL(/\/map/);
      const boot = await user.request.get('/participant-api/bootstrap');
      const bootstrap = (await boot.json()) as {
        project: { key: string; preview: boolean };
        participant: { roles: string[] };
        version: number;
      };
      expect(bootstrap.project).toMatchObject({ key: `${key}__vorschau`, preview: true });
      expect(bootstrap.participant.roles).toEqual(['verwaltung']);

      // create an Objekt in the preview (the run endpoint every device uses)
      const runId = '00000000-0000-7000-8000-0000000373a1';
      const created = await user.request.post(`/api/p/${key}__vorschau/runs`, {
        data: {
          id: runId,
          task: 'erfassen',
          configVersion: bootstrap.version,
          input: { geometrie: { type: 'Point', coordinates: [7.1, 50.73] }, vitalitaet: 'v2' },
        },
      });
      expect(await created.json()).toMatchObject({ outcome: 'accepted' });
      const objekte = (): number => {
        const db = openProjectDbFile(join(E2E_DATA_DIR, `preview-${key}.db`));
        try {
          return (
            db.prepare<{ n: number }>("SELECT count(*) AS n FROM features WHERE type = 'baum'").get()?.n ?? 0
          );
        } finally {
          db.close();
        }
      };
      const before = objekte();
      expect(before).toBeGreaterThan(0);

      // publish: the preview is carried over, not discarded
      await overview.getByRole('button', { name: 'Veröffentlichen' }).click();
      await expect(page.getByTestId('publish-bar')).toBeHidden();
      await expect(page.getByRole('status').filter({ hasText: 'Version 2 ist live.' }).first()).toBeVisible();
      expect(objekte()).toBe(before);
      const after = (await (await ctx.get(`/builder-api/${key}/preview`)).json()) as PreviewBody;
      expect(after.status).toBe('ready');
      expect(after.logins.map((l) => l.role)).toContain('verwaltung');

      // the same link still signs in
      const again = await browser.newContext({
        viewport: size.viewport,
        locale: 'de-DE',
        baseURL: baseURL ?? '',
      });
      const second = await again.newPage();
      await second.goto(link);
      await expect(second).toHaveURL(/\/map/);

      await phone.close();
      await again.close();
      await ctx.dispose();
    });
  }
});
