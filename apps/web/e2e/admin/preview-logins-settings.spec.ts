import { expect, test } from '@playwright/test';
import { goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-505 (owner 2026-10-05): the "Vorschau-Logins" are on "Status & Freigabe" of Projekteinstellungen (v3's page
 * "Entwurf — Vorschau & Release"), usable before any publish. A project made from a template, never published: the
 * admin copies a login, signs in with it on a fresh device and sees the draft in the preview. The deploy overview
 * still shows the same card. Phone (390x844) and desktop (1280x800).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

test.use({ locale: 'de-DE' });

for (const size of SIZES) {
  test(`logins on Projektstatus before the first publish, sign in sees the draft (${size.name})`, async ({
    page,
    browser,
    baseURL,
    context,
  }) => {
    expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
    const email = `vls-${size.name}@example.org`;
    createAdmin(email);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize(size.viewport);
    await signInAs(page, email);
    await expect(page).toHaveURL(/\/admin\/projects/);

    await page.goto('/admin/projects/new');
    await page.getByLabel('Projektname').fill(`Vorschau Status ${size.name}`);
    await page.getByLabel('Vorlage').selectOption('baumkataster@1');
    await page.getByRole('button', { name: 'Projekt erstellen' }).click();
    const key = `vorschau_status_${size.name}`;
    await expect(page).toHaveURL(new RegExp(`/admin/projects/${key}/participants$`));

    await page.goto(`/admin/projects/${key}/settings?section=lifecycle`);
    await expect(page.getByTestId('life-status')).toHaveAttribute('data-state', 'draft');
    const card = page.getByTestId('preview-logins');
    await expect(card.getByRole('heading', { name: 'Vorschau-Logins' })).toBeVisible();
    await expect(card.getByTestId('preview-login').filter({ hasText: 'Keine Rolle' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const row = card.getByTestId('preview-login').first();
    await row.getByRole('button', { name: 'Link kopieren' }).click();
    await expect(row.getByRole('button', { name: 'Kopiert!' })).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/login\?token=/);

    const phone = await browser.newContext({
      viewport: size.viewport,
      locale: 'de-DE',
      baseURL: baseURL ?? '',
    });
    const user = await phone.newPage();
    await user.goto(link);
    await expect(user).toHaveURL(/\/map/);
    const bootstrap = (await (await user.request.get('/participant-api/bootstrap')).json()) as {
      project: { key: string; preview: boolean };
    };
    expect(bootstrap.project).toMatchObject({ key: `${key}__vorschau`, preview: true });
    await phone.close();

    // the deploy overview still shows the same card
    await page.getByTestId('publish-bar').getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(page.getByTestId('deploy-overview').getByTestId('preview-logins')).toBeVisible();
  });
}
