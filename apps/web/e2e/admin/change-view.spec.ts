import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { parse, stringify } from 'yaml';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-509 (WP-506's e2e): the change view. A never-published project compares everything as added; after a publish a
 * changed task shows in the change list with its changed keys in brackets (the Objekte count shows for breaking changes only: deploy-overview.spec.ts), and the same diff in
 * "Projektdatei vergleichen" on the deploy overview and on Projektstatus. Phone (390x844) and desktop (1280x800).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

test.use({ locale: 'de-DE' });

const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const size of SIZES) {
  test.describe(`${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('never published: Projektdatei vergleichen shows only added lines', async ({ page }) => {
      expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
      const email = `cv-new-${size.name}@example.org`;
      createAdmin(email);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Aenderung neu ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const key = `aenderung_neu_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${key}/participants$`));

      await page.goto(`/admin/projects/${key}/settings?section=lifecycle`);
      await page.getByRole('button', { name: 'Projektdatei vergleichen' }).click();
      const lines = page.getByTestId('compare-lines');
      await expect(lines).toBeVisible();
      await expect(page.getByTestId('compare-summary')).toContainText('Noch nicht veröffentlicht');
      await expect(lines.locator('[data-op="add"]').first()).toBeVisible();
      await expect(lines.locator('[data-op="remove"]')).toHaveCount(0);
      expect(await noSideways(page)).toBe(true);
    });

    test('after a publish: the changed task is listed with its keys and the same diff shows twice', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const key = `cv_changed_${size.name}`;
      expect(admin(['create-project', key, `Aenderung ${key}`]).status).toBe(0);
      const email = `${key}@example.org`;
      createAdmin(email);
      expect(admin(['add-membership', email, key, 'verwaltung']).status).toBe(0);
      expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
      const ctx: APIRequestContext = await playwright.request.newContext({ baseURL: baseURL ?? '' });
      expect((await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);
      const first = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
      expect(await (await ctx.post(`/api/admin/p/${key}/deploy`, { data: first })).json()).toMatchObject({
        ok: true,
        version: 1,
      });
      const draft = (await (await ctx.get(`/builder-api/${key}/draft`)).json()) as {
        overlay: string;
        revision: number;
      };
      const overlay = parse(draft.overlay) as { override?: Record<string, unknown> };
      overlay.override = { ...overlay.override, 'tasks.zuweisen.label': { de: 'Vergeben', en: 'Assign' } };
      const put = await ctx.put(`/builder-api/${key}/draft`, {
        data: { overlay: stringify(overlay), revision: draft.revision },
      });
      expect(put.status()).toBe(200);

      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto(`/admin/projects/${key}/roles`);
      await page.getByTestId('publish-bar').getByRole('button', { name: 'Veröffentlichen' }).click();
      const overview = page.getByTestId('deploy-overview');
      const line = overview.getByTestId('deploy-group').getByTestId('deploy-line-parts').first();
      await expect(line).toHaveText('(label)');

      await overview.getByRole('button', { name: 'Projektdatei vergleichen' }).click();
      const lines = overview.getByTestId('compare-lines');
      await expect(lines.locator('[data-op="remove"]').filter({ hasText: 'Zuweisen' })).not.toHaveCount(0);
      await expect(lines.locator('[data-op="add"]').filter({ hasText: 'Vergeben' })).not.toHaveCount(0);
      const summary = await overview.getByTestId('compare-summary').innerText();
      expect(await noSideways(page)).toBe(true);

      await page.goto(`/admin/projects/${key}/settings?section=lifecycle`);
      await page.getByRole('button', { name: 'Projektdatei vergleichen' }).click();
      await expect(page.getByTestId('compare-summary')).toHaveText(summary);
      await expect(
        page.getByTestId('compare-lines').locator('[data-op="add"]').filter({ hasText: 'Vergeben' }),
      ).not.toHaveCount(0);
      expect(await noSideways(page)).toBe(true);
      await ctx.dispose();
    });
  });
}
