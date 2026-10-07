import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-356 (S3-25, B-018): the icon designer of an Objektart, v3's "Icons" button on the workflow detail page, against the
 * real built process at phone (390x844) and desktop (1280x800): open it, drop the template's classifying entries with
 * "keine", pick the stage property, set one value icon, and see it saved in the draft (the publish bar). One project
 * per size, so the two journeys do not meet in one draft.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844, project: 'iconsphone' },
  { name: 'desktop', width: 1280, height: 800, project: 'iconsdesktop' },
] as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  createAdmin('icondeploy@example.org');
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect(
    (
      await ctx.post('/api/auth/login', { data: { email: 'icondeploy@example.org', password: PASSWORD } })
    ).status(),
  ).toBe(200);
  for (const { project } of SIZES) {
    expect(admin(['create-project', project, project]).status).toBe(0);
    expect(admin(['add-membership', 'icondeploy@example.org', project, 'verwaltung']).status).toBe(0);
    const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
    const res = await ctx.post(`/api/admin/p/${project}/deploy`, { data: file });
    expect(await res.json()).toMatchObject({ ok: true });
  }
  await ctx.dispose();
});

let admins = 0;
async function signIn(page: Page, project: string): Promise<void> {
  const email = `icons${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, project, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: open Icons, pick the stage property, set a value icon, save it as a draft', async ({
      page,
    }) => {
      await signIn(page, size.project);
      await page.goto(`/admin/projects/${size.project}/types/baum`);
      await expect(page.getByTestId('publish-bar')).toBeHidden();
      await page.getByTestId('data-icons').click();
      const dialog = page.getByTestId('icons-dialog');
      await expect(dialog.getByText('Objektart-Icons')).toBeVisible();

      // The template classifies by the stage; "keine" asks before it drops the four entries.
      await expect(dialog.getByTestId('icons-values')).toBeVisible();
      await dialog.getByTestId('icons-property').selectOption({ label: 'keine' });
      const ask = page.getByRole('alertdialog');
      await expect(ask.getByText(/4 Einträge entfernt/)).toBeVisible();
      await ask.getByRole('button', { name: 'Wechseln und entfernen' }).click();
      await expect(dialog.getByTestId('icons-values')).toBeHidden();
      await expect(page.getByTestId('publish-bar')).toBeVisible(); // the edit is in the draft

      // Pick the stage property: its four options are listed, with v3's Start / Ende badges.
      await dialog.getByTestId('icons-property').selectOption({ label: 'Status' });
      const rows = dialog.getByTestId('icons-values');
      await expect(rows.locator('[data-value]')).toHaveCount(4);
      await expect(rows.locator('[data-value="erfasst"]')).toContainText('Start');
      await expect(rows.locator('[data-value="erledigt"]')).toContainText('Ende');

      // Set one value icon from a template; the designer previews it, saving returns to the overview.
      await rows.locator('[data-value="massnahme"]').getByRole('button', { name: 'Festlegen' }).click();
      await expect(dialog.getByText('Icon-Designer')).toBeVisible();
      await dialog.locator('[data-template="flag"]').click();
      await expect(dialog.getByTestId('icon-preview')).toBeVisible();
      await dialog.getByRole('button', { name: 'Icon speichern' }).click();
      await expect(page.getByText('Icon gespeichert')).toBeVisible();
      await expect(rows.locator('[data-value="massnahme"]')).toContainText('Eigenes Icon');

      // Invalid SVG is refused in place, with nothing written.
      await rows.locator('[data-value="erfasst"]').getByRole('button', { name: 'Festlegen' }).click();
      await dialog.getByTestId('tab-custom').click();
      await dialog.getByTestId('svg-paste').fill('<svg onload="x()"></svg>');
      await expect(dialog.getByTestId('svg-problem')).toContainText('Ungültiges SVG');
      await expect(dialog.getByRole('button', { name: 'Icon speichern' })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Abbrechen' }).click();

      // The draft holds it: reload, open again, the entry is still there.
      await page.reload();
      await page.getByTestId('data-icons').click();
      await expect(page.getByTestId('icons-dialog').locator('[data-value="massnahme"]')).toContainText(
        'Eigenes Icon',
      );
      await expect(page.getByTestId('publish-bar')).toBeVisible();
    });
  });
}
