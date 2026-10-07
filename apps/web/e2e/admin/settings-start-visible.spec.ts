import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';
import { publish } from '../support/publish';

/**
 * WP-397: Erststart "Sichtbare Objektarten" (v3 StartupSection "Sichtbare Workflows", A-040) against the real built
 * process, at phone (390x844) and desktop (1280x800) size. The choice goes into the draft; after publishing, a
 * participant's bootstrap carries `on_at_start` and `values_at_start` of the type.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

const keyOf = (size: string): string => `visible${size}`;
const pageOf = (size: string): string => `/admin/projects/${keyOf(size)}/settings`;
let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  createAdmin('visible-deploy@example.org');
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  for (const size of SIZES) {
    const key = keyOf(size.name);
    expect(admin(['create-project', key, `Sichtbar ${size.name}`]).status).toBe(0);
    expect(admin(['add-membership', 'visible-deploy@example.org', key, 'sachbearbeiter']).status).toBe(0);
  }
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'visible-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  for (const size of SIZES) {
    const file = goldenData('projects/stadtwerke-meldungen.yaml');
    const deploy = await ctx.post(`/api/admin/p/${keyOf(size.name)}/deploy`, { data: file });
    expect(await deploy.json()).toMatchObject({ ok: true });
  }
  await ctx.dispose();
});

async function signIn(page: Page, size: string): Promise<void> {
  const email = `visible${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, keyOf(size), 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

/** A participant with the role `melder`, signed in through its QR token in a context of its own. */
async function participant(
  playwright: Parameters<Parameters<typeof test>[2]>[0]['playwright'],
  baseURL: string,
  size: string,
) {
  const added = admin(['participant', 'add', keyOf(size), `Anna ${Date.now()}`, 'melder']);
  expect(added.status).toBe(0);
  const id = /with id (\S+?)\.?$/m.exec(added.out)?.[1] ?? '';
  const qr = admin(['participant', 'qr', keyOf(size), id]);
  expect(qr.status).toBe(0);
  const token = qr.out.trim().split('\n').at(-1) ?? '';
  const ctx = await playwright.request.newContext({ baseURL });
  expect((await ctx.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  return ctx;
}

interface Compiled {
  file: { types: Record<string, { on_at_start?: boolean; values_at_start?: string[] }> };
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: Alle, a type off and a value off go into the draft, publish, the participant config has them', async ({
      page,
      playwright,
      baseURL,
    }) => {
      test.setTimeout(120_000);
      await signIn(page, size.name);
      await page.goto(`${pageOf(size.name)}?section=startup`);
      await expect(page.getByRole('heading', { level: 2, name: 'Startstellungen' })).toBeVisible();

      // v3 order and state: after the layers, "Alle" on, the type checkboxes disabled.
      const block = page.getByTestId('startup-types');
      await expect(block.getByText('Sichtbare Objektarten')).toBeVisible();
      const all = block.getByRole('switch', { name: 'Alle' });
      await expect(all).toHaveAttribute('aria-checked', 'true');
      await expect(block.getByLabel('Bezirk')).toBeDisabled();

      // "Alle" off enables them; Bezirk off; one Kategorie of Meldung off.
      await all.click();
      await block.getByLabel('Bezirk').uncheck();
      await block.getByRole('button', { name: 'Werte ein- oder ausklappen' }).click();
      const values = page.getByTestId('startup-values-meldung');
      await expect(values.getByText('Werte, die beim Start sichtbar sind')).toBeVisible();
      await values.getByLabel('Müll').uncheck();
      await page.getByRole('button', { name: 'Startstellungen speichern' }).click();
      await expect(page.getByText('Startstellungen gespeichert')).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeVisible();

      // The saved state reads back after a reload.
      await page.reload();
      const again = page.getByTestId('startup-types');
      await expect(again.getByRole('switch', { name: 'Alle' })).toHaveAttribute('aria-checked', 'false');
      await expect(again.getByLabel('Bezirk')).not.toBeChecked();
      await again.getByRole('button', { name: 'Werte ein- oder ausklappen' }).click();
      await expect(page.getByTestId('startup-values-meldung').getByLabel('Müll')).not.toBeChecked();
      await expect(page.getByTestId('startup-values-meldung').getByLabel('Straße')).toBeChecked();

      await publish(page, { via: 'bar' });
      const ctx = await participant(playwright, baseURL ?? '', size.name);
      const bootstrap = (await (await ctx.get('/participant-api/bootstrap')).json()) as {
        compiled: Compiled;
      };
      const { types } = bootstrap.compiled.file;
      expect(types['bezirk']?.on_at_start).toBe(false);
      expect(types['meldung']?.values_at_start).toEqual(['strasse', 'beleuchtung', 'spielplatz']);
      expect(types['meldung']?.on_at_start).toBeUndefined();
      await ctx.dispose();
    });
  });
}
