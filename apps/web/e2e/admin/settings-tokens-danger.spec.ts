import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-388: the Projekteinstellungen sections "GIS-Zugang" (API-Tokens, Q18) and "Projekt löschen" (Gefahrenzone) against
 * the real built process, at phone (390x844) and desktop (1280x800) size. A token made here lets a QGIS-style client
 * (HTTP Basic, the token as user name) read the project's OGC endpoint as that participant, and stops after Widerrufen.
 * The delete needs the typed project key and removes the project: a second request finds nothing.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844, key: 'tokenstadtphone' },
  { name: 'desktop', width: 1280, height: 800, key: 'tokenstadtdesktop' },
] as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  createAdmin('token-deploy@example.org');
  for (const { key } of SIZES) {
    expect(admin(['create-project', key, `Token Stadt ${key}`]).status).toBe(0);
    expect(admin(['add-membership', 'token-deploy@example.org', key, 'sachbearbeiter']).status).toBe(0);
  }
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'token-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  for (const { key } of SIZES) {
    const deploy = await ctx.post(`/api/admin/p/${key}/deploy`, {
      data: goldenData('projects/stadtwerke-meldungen.yaml'),
    });
    expect(await deploy.json()).toMatchObject({ ok: true });
  }
  await ctx.dispose();
});

async function signIn(page: Page, key: string): Promise<void> {
  const email = `token-${key}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, key, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: create a token, connect as QGIS, revoke; then delete the project with the typed key', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const { key } = size;
      const added = admin(['participant', 'add', key, 'Anna Token', 'melder']);
      expect(added.status).toBe(0);
      const id = /with id (\S+?)\.?$/m.exec(added.out)?.[1] ?? '';

      await signIn(page, key);
      await page.goto(`/admin/projects/${key}/settings`);
      const nav = page.getByRole('navigation', { name: 'Einstellungsbereiche' });
      await expect(nav).toContainText('Integrationen');
      await expect(nav).toContainText('Gefahrenzone');
      await nav.getByRole('button', { name: 'GIS-Zugang' }).click();
      await expect(page).toHaveURL(/[?&]section=api-tokens/);
      await expect(page.getByRole('heading', { level: 2, name: 'QGIS-/GIS-Zugang' })).toBeVisible();
      await expect(page.getByText('Noch keine Token.')).toBeVisible();

      // Create: the secret shows once, and the table lists it with the participant and the last four characters.
      await page.getByLabel('Teilnehmer', { exact: true }).selectOption(id);
      await page.getByLabel('Token-Bezeichnung').fill('Mein Laptop');
      await page.getByRole('button', { name: 'Token erstellen' }).click();
      const secret = (await page.getByTestId('created-token').locator('code').textContent()) ?? '';
      expect(secret).toMatch(/^ubk_/);
      await expect(page.getByTestId('token-table')).toContainText('Mein Laptop');
      await expect(page.getByTestId('token-table')).toContainText(`…${secret.slice(-4)}`);
      await expect(page.getByTestId('token-table')).toContainText('Anna Token');
      await expect(page.getByText(`/api/p/${key}/ogc`)).toBeVisible();

      // QGIS: HTTP Basic with the token as user name reads the endpoint as the participant.
      const qgis = await playwright.request.newContext({
        baseURL: baseURL ?? '',
        httpCredentials: { username: secret, password: '', send: 'always' },
      });
      expect((await qgis.get(`/api/p/${key}/ogc/collections`)).status()).toBe(200);

      // Widerrufen (after the confirmation): the same request is refused.
      page.once('dialog', (d) => void d.accept());
      await page.getByRole('button', { name: /Widerrufen/ }).click();
      await expect(page.getByText('Noch keine Token.')).toBeVisible();
      expect((await qgis.get(`/api/p/${key}/ogc/collections`)).status()).toBe(401);
      await qgis.dispose();

      // Gefahrenzone: the typed key is needed; then the project is gone.
      await nav.getByRole('button', { name: 'Projekt löschen' }).click();
      await page.getByTestId('settings-section').getByRole('button', { name: 'Projekt löschen' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByTestId('delete-counts')).toContainText('Teilnehmende: 1');
      const confirm = dialog.getByRole('button', { name: 'Löschen' });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(/Projektschlüssel/).fill('falsch');
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(/Projektschlüssel/).fill(key);
      await confirm.click();
      await expect(page).toHaveURL(/\/admin\/projects$/);

      const again = await page.request.delete(`/api/admin/projects/${key}`, {
        data: { confirm: key },
        headers: { 'sec-fetch-site': 'same-origin' },
      });
      expect(again.status()).toBe(404);
      expect((await page.request.get(`/admin/projects/${key}/settings`)).status()).not.toBe(200);
    });
  });
}
