import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parse } from 'yaml';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-1049: the whole journey through the UI. The admin renames a task in the builder, presses Speichern, presses
 * Veröffentlichen and sees the change in the change list and in the YAML diff ("Projektdatei vergleichen").
 * (change-view.spec.ts edits the draft through the API.) Phone (390x844) and desktop (1280x800).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

test.use({ locale: 'de-DE' });

for (const size of SIZES) {
  test.describe(`${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('builder edit, Speichern, Veröffentlichen: the change and the YAML diff show the new label', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const key = `cvb_${size.name}`;
      const email = `${key}@example.org`;
      const label = `Vergeben ${size.name}`;
      expect(admin(['create-project', key, `CVB ${size.name}`]).status).toBe(0);
      createAdmin(email);
      expect(admin(['add-membership', email, key, 'verwaltung']).status).toBe(0);
      expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
      const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
      expect((await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);
      const first = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
      expect(await (await ctx.post(`/api/admin/p/${key}/deploy`, { data: first })).json()).toMatchObject({
        ok: true,
        version: 1,
      });
      await ctx.dispose();

      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto(`/admin/projects/${key}/types/baum/builder`);
      const frame = page.getByTestId('builder-frame');
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.locator('[data-path="tasks.zuweisen"]').dispatchEvent('click');
      const pane = page.getByTestId('task-pane');
      await expect(pane).toBeVisible();
      await pane.getByTestId('task-label').fill(label);
      await pane.getByTestId('task-label').blur();
      await expect(page.getByTestId('unsaved')).toBeVisible();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();

      await page.getByTestId('publish-bar').getByRole('button', { name: 'Veröffentlichen' }).click();
      const overview = page.getByTestId('deploy-overview');
      await expect(overview.getByTestId('deploy-group').getByTestId('deploy-line-parts').first()).toHaveText(
        '(label)',
      );
      await overview.getByRole('button', { name: 'Projektdatei vergleichen' }).click();
      const lines = overview.getByTestId('compare-lines');
      await expect(lines.locator('[data-op="add"]').filter({ hasText: label })).not.toHaveCount(0);
      await expect(lines.locator('[data-op="remove"]').filter({ hasText: 'Zuweisen' })).not.toHaveCount(0);
    });
  });
}
