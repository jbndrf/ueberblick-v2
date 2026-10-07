import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { publish } from '../support/publish';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-385: Projekteinstellungen > Kartenebenen (v3 `LayersSection.svelte`) against the real built process, at phone
 * (390x844) and desktop (1280x800) size: add a Kachel-URL layer and a WMS layer through the dialog, edit one in the
 * edit dialog, set one as base, reorder, delete, then publish from the bar and read the layers as a participant
 * (the bootstrap's compiled file).
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844, key: 'ebenenphone' },
  { name: 'desktop', width: 1280, height: 800, key: 'ebenendesktop' },
] as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  createAdmin('ebenen-deploy@example.org');
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'ebenen-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  for (const size of SIZES) {
    expect(admin(['create-project', size.key, `Ebenen ${size.name}`]).status).toBe(0);
    expect(admin(['add-membership', 'ebenen-deploy@example.org', size.key, 'sachbearbeiter']).status).toBe(0);
    const deploy = await ctx.post(`/api/admin/p/${size.key}/deploy`, {
      data: goldenData('projects/stadtwerke-meldungen.yaml'),
    });
    expect(await deploy.json()).toMatchObject({ ok: true });
  }
  await ctx.dispose();
});

async function signIn(page: Page, key: string): Promise<void> {
  const email = `ebenen${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, key, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

/** "Veröffentlichen" from the section "Status & Freigabe": the section's own button opens the deploy overview, whose button deploys. */
async function publishFromBar(page: Page, key: string): Promise<void> {
  await page.goto(`/admin/projects/${key}/settings?section=lifecycle`);
  await expect(page.getByTestId('life-status')).toContainText('unveröffentlichte Änderungen');
  await publish(page, { via: 'lifecycle' });
  await expect(page.getByTestId('life-status')).toHaveAttribute('data-state', 'live');
}

async function participantLayers(
  playwright: Parameters<Parameters<typeof test>[2]>[0]['playwright'],
  baseURL: string,
  key: string,
): Promise<Record<string, { kind: string; source: Record<string, unknown>; opacity?: number }>> {
  const added = admin(['participant', 'add', key, `Anna ${Date.now()}`, 'melder']);
  expect(added.status).toBe(0);
  const id = /with id (\S+?)\.?$/m.exec(added.out)?.[1] ?? '';
  const qr = admin(['participant', 'qr', key, id]);
  const token = qr.out.trim().split('\n').at(-1) ?? '';
  const ctx = await playwright.request.newContext({ baseURL });
  expect((await ctx.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  const bootstrap = await (await ctx.get('/participant-api/bootstrap')).json();
  await ctx.dispose();
  return bootstrap.compiled.file.map?.layers ?? {};
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: add, edit, set as base, reorder and delete layers, publish, read them as a participant', async ({
      page,
      playwright,
      baseURL,
    }) => {
      await signIn(page, size.key);
      await page.goto(`/admin/projects/${size.key}/settings?section=layers`);
      const nav = page.getByRole('navigation', { name: 'Einstellungsbereiche' });
      await expect(nav.getByRole('button', { name: 'Kartenebenen' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { level: 2, name: 'Kartenebenen' })).toBeVisible();

      // No layer yet: the empty state and the hint (v3).
      await expect(page.getByTestId('layers-empty')).toContainText('Noch keine Layer');
      await expect(page.getByText('Kein Basis-Layer konfiguriert', { exact: false })).toBeVisible();

      // A preset first (the first one is the base), then a Kachel-URL layer through the dialog.
      await page.getByTestId('layers-empty').getByRole('button', { name: 'Layer hinzufügen' }).click();
      const dialog = page.getByRole('dialog', { name: 'Kartenebene hinzufügen' });
      await dialog.getByRole('button', { name: /^OpenStreetMap(?! Germany)/ }).click();
      await expect(page.getByText('Layer hinzugefügt')).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeVisible();
      await expect(dialog).toBeHidden(); // v3 closes the dialog after a preset
      await page.getByRole('button', { name: 'Layer hinzufügen' }).first().click();
      await expect(dialog.getByText('Hinzugefügt', { exact: true })).toBeVisible();

      await dialog.getByRole('tab', { name: 'Kachel-URL' }).click();
      const panel = dialog.locator('[role="tabpanel"][data-state="active"]');
      await panel.getByLabel('Name').fill('Orthofoto');
      await panel.getByLabel('Kachel-URL-Vorlage').fill('https://tiles.example.org/ortho/{z}/{x}/{y}.png');
      await panel.getByRole('button', { name: 'Layer hinzufügen' }).click();
      await expect(page.getByText('Kachelschicht hinzugefügt')).toBeVisible();
      await expect(dialog).toBeHidden();

      await page.reload();
      const table = page.getByTestId('layers-table');
      await expect(table.getByText('OpenStreetMap')).toBeVisible();
      await expect(table.getByText('Orthofoto')).toBeVisible();
      await expect(page.getByText('Basis-Layer: OpenStreetMap')).toBeVisible();

      // Edit dialog: attribution and opacity of the Orthofoto.
      const orthofoto = table.locator('[data-row-id="orthofoto"]');
      await orthofoto.getByRole('button', { name: 'Menü öffnen' }).click();
      await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
      const edit = page.getByRole('dialog', { name: 'Layer bearbeiten' });
      await edit.getByLabel('Quellenangabe (optional)').fill('Stadt Musterstadt');
      await edit.getByLabel('Deckkraft').fill('40');
      await edit.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Layer aktualisiert')).toBeVisible();
      await expect(edit).toBeHidden();

      // Reorder: Orthofoto up, so it is drawn below the base.
      await orthofoto.getByRole('button', { name: 'Menü öffnen' }).click();
      await page.getByRole('menuitem', { name: 'Nach oben' }).click();
      await expect(page.getByText('Reihenfolge gespeichert')).toBeVisible();
      await expect(table.locator('[data-row-id]').first()).toHaveAttribute('data-row-id', 'orthofoto');

      // Set as base, then back to overlay.
      await orthofoto.getByRole('button', { name: 'Menü öffnen' }).click();
      await page.getByRole('menuitem', { name: 'Als Basis setzen' }).click();
      await expect(page.getByText('Layer als Basis festgelegt')).toBeVisible();
      await expect(page.getByText('Basis-Layer: Orthofoto, OpenStreetMap')).toBeVisible();

      // A WMS layer, then delete it again after the confirmation.
      await page.getByRole('button', { name: 'Layer hinzufügen' }).first().click();
      await dialog.getByRole('tab', { name: 'WMS' }).click();
      const wms = dialog.locator('[role="tabpanel"][data-state="active"]');
      await wms.getByLabel('Name').fill('Flurstücke');
      await wms.getByLabel('WMS-URL').fill('https://wms.example.org/ows');
      await wms.getByLabel('Layer', { exact: true }).fill('flur');
      await wms.getByRole('button', { name: 'Layer hinzufügen' }).click();
      await expect(page.getByText('WMS-Layer hinzugefügt')).toBeVisible();
      await page.keyboard.press('Escape');
      const flur = table.locator('[data-row-id="flurstucke"]');
      await expect(flur).toBeVisible();
      await flur.getByRole('button', { name: 'Menü öffnen' }).click();
      await page.getByRole('menuitem', { name: 'Löschen' }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Flurstücke');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByText('Kartenebene gelöscht')).toBeVisible();
      await expect(flur).toHaveCount(0);

      // Publish: the participant bootstrap carries the layers, in the file as saved.
      await publishFromBar(page, size.key);
      const layers = await participantLayers(playwright, baseURL ?? '', size.key);
      expect(Object.keys(layers).sort()).toEqual(['openstreetmap', 'orthofoto']);
      expect(layers['orthofoto']).toMatchObject({
        kind: 'base',
        opacity: 0.4,
        attribution: 'Stadt Musterstadt',
        source: { type: 'xyz', url: 'https://tiles.example.org/ortho/{z}/{x}/{y}.png' },
      });
      expect(layers['openstreetmap']?.source).toEqual({ type: 'preset', preset: 'osm' });
    });
  });
}
