import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-396: v3's 'Geometrie beim Erstellen' in the Beziehungen dialog against the real built process, at phone (390x844)
 * and desktop (1280x800) size. The mode is config: 'übernehmen' is `inherit_position` on the parent's relation,
 * 'keine' is its absence on a child without geometry, and a child type with a position of its own can only be
 * 'zeichnen' (shown, disabled). Reading a saved relation back selects the same mode. The planned run of a child
 * created from its parent is the participant journey (lead-b's e2e); here the config is asserted by reading it back.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const KEY = 'geometriestadt';
const PAGE = `/admin/projects/${KEY}/relations`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Geometrie Stadt']).status).toBe(0);
  createAdmin('geometrie-deploy@example.org');
  expect(admin(['add-membership', 'geometrie-deploy@example.org', KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'geometrie-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `geometrie${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const rowOf = (page: Page, name: string) => page.locator('li[data-relation]').filter({ hasText: name });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: übernehmen is the default, keine and back, and a child with its own geometry is zeichnen', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(PAGE);
      const name = `Einsätze ${size.name}`;

      // Einsatz has no geometry: übernehmen (default, as in v3) or keine.
      await page.getByRole('button', { name: 'Beziehung erstellen' }).click();
      const dialog = page.getByRole('dialog', { name: 'Beziehung erstellen' });
      await dialog.getByLabel('Name').fill(name);
      await dialog.getByLabel('Eltern-Objektart').selectOption({ label: 'Meldung' });
      await dialog.getByLabel('Kind-Objektart').selectOption({ label: 'Einsatz' });
      const geometry = dialog.getByLabel('Geometrie beim Erstellen');
      await expect(geometry).toBeEnabled();
      await expect(geometry).toHaveValue('inherit');
      await expect(geometry.locator('option')).toHaveText([
        'Vom Eltern-Objekt übernehmen',
        'Keine eigene Geometrie',
      ]);
      await dialog.getByRole('button', { name: 'Erstellen' }).click();
      await expect(page.getByText('Beziehung erstellt')).toBeVisible();
      await expect(rowOf(page, name)).toContainText('Vom Eltern-Objekt übernehmen');

      // keine: read back from the config on the next open.
      await rowOf(page, name).getByRole('button', { name: 'Beziehung bearbeiten' }).click();
      const edit = page.getByRole('dialog', { name: 'Beziehung bearbeiten' });
      await expect(edit.getByLabel('Geometrie beim Erstellen')).toHaveValue('inherit');
      await edit.getByLabel('Geometrie beim Erstellen').selectOption({ label: 'Keine eigene Geometrie' });
      await edit.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Beziehung aktualisiert')).toBeVisible();
      await expect(rowOf(page, name)).toContainText('Keine eigene Geometrie');
      await page.reload();
      await rowOf(page, name).getByRole('button', { name: 'Beziehung bearbeiten' }).click();
      const again = page.getByRole('dialog', { name: 'Beziehung bearbeiten' });
      await expect(again.getByLabel('Geometrie beim Erstellen')).toHaveValue('none');
      await again.getByRole('button', { name: 'Abbrechen' }).click();

      // A child type with a position of its own can only be drawn: the select is shown, disabled, with a hint.
      await page.getByRole('button', { name: 'Beziehung erstellen' }).click();
      const own = page.getByRole('dialog', { name: 'Beziehung erstellen' });
      await own.getByLabel('Name').fill(`Meldungen ${size.name}`);
      await own.getByLabel('Eltern-Objektart').selectOption({ label: 'Bezirk' });
      await own.getByLabel('Kind-Objektart').selectOption({ label: 'Meldung' });
      await expect(own.getByLabel('Geometrie beim Erstellen')).toBeDisabled();
      await expect(own.getByLabel('Geometrie beim Erstellen')).toHaveValue('draw');
      await expect(own.getByText(/hat eine eigene Position/)).toBeVisible();
      await own.getByRole('button', { name: 'Abbrechen' }).click();

      // Clean up: the draft is the published file again.
      await rowOf(page, name).getByRole('button', { name: 'Beziehung löschen' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByText('Beziehung gelöscht')).toBeVisible();
    });
  });
}
