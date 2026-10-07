import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-371 (owner A2): the Beziehungen dialog's "Anbindung" and "Wenn das Eltern-Objekt gelöscht wird" against the real
 * built process, at phone (390x844) and desktop (1280x800) size. The choices are written as the child's creating
 * task and as steps of the parent's delete task, so they show in the builder like any other task; editing them
 * rewrites the same entries, and deleting the relation takes them away again.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const KEY = 'optionenstadt';
const PAGE = `/admin/projects/${KEY}/relations`;
const BUILDER = `/admin/projects/${KEY}/types/bezirk/builder`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Optionen Stadt']).status).toBe(0);
  createAdmin('optionen-deploy@example.org');
  expect(admin(['add-membership', 'optionen-deploy@example.org', KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'optionen-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `optionen${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const rowOf = (page: Page, name: string) => page.locator('li[data-relation]').filter({ hasText: name });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: pick the options, see them as a task in the builder, change them, delete the relation', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(PAGE);
      const name = `Bezirks-Meldungen ${size.name}`;

      // v3's defaults: Verbindlich, Kinder trennen. Geometrie beim Erstellen is covered by relations-geometry.spec.ts.
      await page.getByRole('button', { name: 'Beziehung erstellen' }).click();
      const dialog = page.getByRole('dialog', { name: 'Beziehung erstellen' });
      await expect(dialog.getByLabel('Anbindung')).toHaveValue('enforced');
      await expect(dialog.getByLabel('Wenn das Eltern-Objekt gelöscht wird')).toHaveValue('nullify');
      await expect(
        dialog.getByText('Kind-Objekte können nur vom Eltern-Objekt aus erstellt werden'),
      ).toBeVisible();
      await dialog.getByLabel('Name').fill(name);
      await dialog.getByLabel('Eltern-Objektart').selectOption({ label: 'Bezirk' });
      await dialog.getByLabel('Kind-Objektart').selectOption({ label: 'Meldung' });
      await dialog.getByLabel('Anbindung').selectOption({ label: 'Optional' });
      await expect(
        dialog.getByText('Auch eigenständig erstellbar; beim Erstellen verknüpfbar'),
      ).toBeVisible();
      await dialog
        .getByLabel('Wenn das Eltern-Objekt gelöscht wird')
        .selectOption({ label: 'Kinder mitlöschen' });
      await dialog.getByRole('button', { name: 'Erstellen' }).click();
      await expect(page.getByText('Beziehung erstellt')).toBeVisible();
      await expect(rowOf(page, name)).toContainText('Optional');
      await expect(page.getByTestId('publish-bar')).toBeVisible();

      // The options are config: the child's creating task is in the parent's builder, named from the relation.
      await page.goto(BUILDER);
      await expect(page.getByText(`${name} anlegen`).first()).toBeVisible();

      // Editing reads the choices back from that config and rewrites the same entries.
      await page.goto(PAGE);
      await rowOf(page, name).getByRole('button', { name: 'Beziehung bearbeiten' }).click();
      const edit = page.getByRole('dialog', { name: 'Beziehung bearbeiten' });
      await expect(edit.getByLabel('Anbindung')).toHaveValue('optional');
      await expect(edit.getByLabel('Wenn das Eltern-Objekt gelöscht wird')).toHaveValue('cascade');
      await edit.getByLabel('Anbindung').selectOption({ label: 'Verbindlich' });
      await edit
        .getByLabel('Wenn das Eltern-Objekt gelöscht wird')
        .selectOption({ label: 'Löschen blockieren' });
      await edit.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Beziehung aktualisiert')).toBeVisible();
      await expect(rowOf(page, name)).toContainText('Verbindlich');
      await rowOf(page, name).getByRole('button', { name: 'Beziehung bearbeiten' }).click();
      const again = page.getByRole('dialog', { name: 'Beziehung bearbeiten' });
      await expect(again.getByLabel('Wenn das Eltern-Objekt gelöscht wird')).toHaveValue('block');
      await again.getByRole('button', { name: 'Abbrechen' }).click();

      // Deleting the relation takes its task and steps along: the draft is the published file again.
      await rowOf(page, name).getByRole('button', { name: 'Beziehung löschen' }).click();
      const confirm = page.getByRole('alertdialog');
      await confirm.getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByText('Beziehung gelöscht')).toBeVisible();
      await expect(rowOf(page, name)).toHaveCount(0);
      await expect(page.getByTestId('publish-bar')).toBeHidden();
    });
  });
}
