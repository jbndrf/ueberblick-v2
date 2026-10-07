import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';
import { publish } from '../support/publish';

/**
 * WP-365: the Beziehungen page (v3 `relations/+page.svelte`) against the real built process, at phone (390x844) and
 * desktop (1280x800) size: create "Meldungen: Bezirk -> Meldung" (name, Eltern, Kind, Multiplizität), see it in the
 * list and in the draft (the publish bar), change its multiplicity, publish it (it is live), and delete it with the
 * confirm that asks first.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const KEY = 'beziehungsstadt';
const PAGE = `/admin/projects/${KEY}/relations`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Beziehungen Stadt']).status).toBe(0);
  createAdmin('beziehungen-deploy@example.org');
  expect(admin(['add-membership', 'beziehungen-deploy@example.org', KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'beziehungen-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `beziehungen${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const rowOf = (page: Page, name: string) => page.locator('li[data-relation]').filter({ hasText: name });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: create a relation, change its multiplicity, publish it, delete a draft one', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(PAGE);
      await expect(page.getByRole('heading', { name: 'Beziehungen' })).toBeVisible();
      await expect(
        page.getByText('Eltern-Kind-Beziehungen zwischen den Objektarten dieses Projekts'),
      ).toBeVisible();

      // Beziehung erstellen: Name, Eltern, Kind, Multiplizität (native selects, as in v3).
      const name = `Meldungen ${size.name}`;
      await page.getByRole('button', { name: 'Beziehung erstellen' }).click();
      const dialog = page.getByRole('dialog', { name: 'Beziehung erstellen' });
      await dialog.getByLabel('Name').fill(name);
      await dialog.getByLabel('Eltern-Objektart').selectOption({ label: 'Bezirk' });
      await dialog.getByLabel('Kind-Objektart').selectOption({ label: 'Bezirk' });
      await expect(dialog.getByText('Eltern- und Kind-Objektart müssen unterschiedlich sein')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Erstellen' })).toBeDisabled();
      await dialog.getByLabel('Kind-Objektart').selectOption({ label: 'Meldung' });
      await dialog.getByRole('button', { name: 'Erstellen' }).click();
      await expect(page.getByText('Beziehung erstellt')).toBeVisible();
      await expect(rowOf(page, name)).toContainText('Bezirk');
      await expect(rowOf(page, name)).toContainText('Meldung');
      await expect(rowOf(page, name)).toContainText('Mehrere');
      await expect(page.getByTestId('publish-bar')).toBeVisible(); // the relation is in the draft

      // Beziehung bearbeiten: the multiplicity.
      await rowOf(page, name).getByRole('button', { name: 'Beziehung bearbeiten' }).click();
      const edit = page.getByRole('dialog', { name: 'Beziehung bearbeiten' });
      await expect(edit.getByLabel('Name')).toHaveValue(name);
      await edit.getByLabel('Multiplizität').selectOption({ label: 'Einzeln' });
      await edit.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Beziehung aktualisiert')).toBeVisible();
      await expect(rowOf(page, name)).toContainText('Einzeln');

      // Veröffentlichen: the relation is live and still listed after a reload.
      await publish(page, { via: 'bar' });
      await page.reload();
      await expect(rowOf(page, name)).toBeVisible();

      // Beziehung löschen: asks first. A relation that is already live cannot simply vanish on publishing (the
      // server asks for a mapping, `mapping_required`), so the journey deletes one that only the draft has.
      const draftOnly = `Entwurf ${size.name}`;
      await page.getByRole('button', { name: 'Beziehung erstellen' }).click();
      const second = page.getByRole('dialog', { name: 'Beziehung erstellen' });
      await second.getByLabel('Name').fill(draftOnly);
      await second.getByLabel('Eltern-Objektart').selectOption({ label: 'Meldung' });
      await second.getByLabel('Kind-Objektart').selectOption({ label: 'Bezirk' });
      await second.getByRole('button', { name: 'Erstellen' }).click();
      await expect(rowOf(page, draftOnly)).toBeVisible();
      await rowOf(page, draftOnly).getByRole('button', { name: 'Beziehung löschen' }).click();
      const confirm = page.getByRole('alertdialog');
      await expect(confirm.getByText(/Diese Beziehung löschen\?/)).toBeVisible();
      await confirm.getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByText('Beziehung gelöscht')).toBeVisible();
      await expect(rowOf(page, draftOnly)).toHaveCount(0);
      // The draft is the published file again, so the other size starts from the same state.
      await expect(page.getByTestId('publish-bar')).toBeHidden();
    });
  });
}
