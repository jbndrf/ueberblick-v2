import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';
import { publish } from '../support/publish';

/**
 * WP-387: Projekteinstellungen "Status & Freigabe", "Info-Seiten" and "Offline-Pakete" (v3 `LifecycleSection`,
 * `InfoPagesSection`, `OfflinePacksSection`) against the real built process, at phone (390x844) and desktop (1280x800)
 * size. An info page is created, edited and deleted in the draft, published from "Status & Freigabe", and read as a
 * participant (the bootstrap). A pack is defined with a region drawn on the real map, published, and its build state
 * follows from the existing endpoint.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.1.0.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

let admins = 0;

/** A project of its own per size, so the two journeys do not see each other's pages and packs. */
async function setup(
  playwright: Parameters<Parameters<typeof test>[2]>[0]['playwright'],
  baseURL: string,
  key: string,
): Promise<void> {
  expect(admin(['create-project', key, `Einstellungen ${key}`]).status).toBe(0);
  const email = `deploy-${key}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, key, 'kontrolle']).status).toBe(0);
  admin(['publish-template', TEMPLATE]);
  const ctx = await playwright.request.newContext({ baseURL });
  expect(
    (await ctx.post('/api/auth/login', { data: { email, password: 'correct horse battery' } })).status(),
  ).toBe(200);
  const overlay = goldenData('projects/musterstadt-baeume.yaml') as { add?: Record<string, unknown> };
  // a pmtiles layer on a closed port: packable, and its build fails at once without touching the network
  overlay.add = {
    ...overlay.add,
    'map.layers.luft': {
      label: { de: 'Luftbild' },
      kind: 'overlay',
      source: { type: 'pmtiles', url: 'http://127.0.0.1:9/luft.pmtiles', tile_type: 'raster' },
    },
  };
  const deploy = await ctx.post(`/api/admin/p/${key}/deploy`, { data: overlay });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
}

async function signIn(page: Page, key: string): Promise<void> {
  const email = `settings387-${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, key, 'kontrolle']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

async function participantBootstrap(
  playwright: Parameters<Parameters<typeof test>[2]>[0]['playwright'],
  baseURL: string,
  key: string,
): Promise<{ infoPages: { key: string; title: unknown }[] }> {
  const added = admin(['participant', 'add', key, `Anna ${Date.now()}`, 'kontrolle']);
  expect(added.status).toBe(0);
  const id = /with id (\S+?)\.?$/m.exec(added.out)?.[1] ?? '';
  const qr = admin(['participant', 'qr', key, id]);
  const token = qr.out.trim().split('\n').at(-1) ?? '';
  const ctx = await playwright.request.newContext({ baseURL });
  expect((await ctx.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  const bootstrap = await (await ctx.get('/participant-api/bootstrap')).json();
  await ctx.dispose();
  return bootstrap;
}

/** "Veröffentlichen" from the section "Status & Freigabe": the section's own button opens the deploy overview, whose button deploys. */
async function publishFromLifecycle(page: Page, key: string): Promise<void> {
  await page.goto(`/admin/projects/${key}/settings?section=lifecycle`);
  await expect(page.getByTestId('life-status')).toContainText('unveröffentlichte Änderungen');
  await publish(page, { via: 'lifecycle' });
  await expect(page.getByTestId('life-status')).toHaveAttribute('data-state', 'live');
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });
    const KEY = `eintragsstadt_${size.name}`;

    test.beforeAll(async ({ playwright, baseURL }) => {
      await setup(playwright, baseURL ?? '', KEY);
    });

    test('journey: info pages create, edit, delete, publish, read as a participant', async ({
      page,
      playwright,
      baseURL,
    }) => {
      await signIn(page, KEY);
      await page.goto(`/admin/projects/${KEY}/settings?section=info-pages`);
      const nav = page.getByRole('navigation', { name: 'Einstellungsbereiche' });
      await expect(nav).toContainText('Funktionen');
      await expect(page.getByRole('heading', { level: 2, name: 'Infoseiten' })).toBeVisible();

      // the template's two pages are listed in their order
      await expect(page.getByTestId('info-page')).toHaveCount(2);
      await expect(page.getByTestId('info-page').first()).toContainText('Willkommen');

      // create
      await page.getByRole('button', { name: 'Infoseite hinzufügen' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('info-variables')).toContainText('$qrloginlink');
      await dialog.getByLabel('Titel').fill('Datenschutz');
      await dialog.getByLabel('Inhalt').fill('<p>Ihr Login: $loginlink</p>');
      await dialog.getByLabel('Sortierung').fill('0');
      await dialog.getByRole('button', { name: 'Erstellen' }).click();
      await expect(page.getByText('Infoseite erfolgreich erstellt')).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeVisible();
      await expect(page.getByTestId('info-page').first()).toContainText('Datenschutz');

      // edit: the title changes, the key stays
      await page
        .getByTestId('info-page')
        .first()
        .getByRole('button', { name: 'Infoseite bearbeiten' })
        .click();
      await dialog.getByLabel('Titel').fill('Datenschutzerklärung');
      await dialog.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Infoseite erfolgreich aktualisiert')).toBeVisible();
      await expect(page.getByTestId('info-page').first()).toContainText('Datenschutzerklärung');

      // delete the template's "Kontakt" with the two-step button
      const kontakt = page.locator('[data-testid=info-page][data-key=kontakt]');
      await kontakt.getByRole('button', { name: 'Löschen' }).click();
      await kontakt.getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByText('Infoseite erfolgreich gelöscht')).toBeVisible();
      await expect(page.getByTestId('info-page')).toHaveCount(2);

      // a reload keeps the draft
      await page.reload();
      await expect(page.getByTestId('info-page')).toHaveCount(2);

      // Status & Freigabe: the draft differs from the live version; publish from here
      await publishFromLifecycle(page, KEY);

      // as a participant: the bootstrap carries the pages in sort order, without the deleted one
      const bootstrap = await participantBootstrap(playwright, baseURL ?? '', KEY);
      expect(bootstrap.infoPages.map((p) => p.key)).toEqual(['datenschutz', 'willkommen']);
      expect(bootstrap.infoPages.map((p) => p.key)).not.toContain('kontakt');
    });

    test('journey: define an offline pack with a region on the map, publish, follow its build', async ({
      page,
    }) => {
      await signIn(page, KEY);
      await page.goto(`/admin/projects/${KEY}/settings?section=offline-packs`);
      await expect(page.getByRole('heading', { level: 2, name: 'Offline-Pakete' })).toBeVisible();
      await expect(page.getByTestId('pack-empty')).toBeVisible();

      await page.getByRole('button', { name: 'Paket erstellen' }).first().click();
      const dialog = page.getByTestId('pack-dialog');
      // v3's checks in v3's order: no region yet
      await dialog.getByRole('button', { name: 'Paket erstellen' }).click();
      await expect(page.getByText('Bitte zeichnen Sie eine Region auf der Karte')).toBeVisible();

      // the region: two taps on opposite corners of the real map
      await dialog.getByRole('button', { name: /Region auf der Karte zeichnen/ }).click();
      const map = page.getByTestId('region-map');
      await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
      const box = await map.boundingBox();
      expect(box).not.toBeNull();
      const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
      const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
      await page.mouse.click(cx - 60, cy - 40);
      await expect(page.getByTestId('region-hint')).toContainText('gegenüberliegende Ecke');
      await page.mouse.click(cx + 60, cy + 40);
      await expect(page.getByTestId('region-stats')).toContainText('km²');
      await page.getByRole('button', { name: 'Bestätigen' }).click();
      await expect(dialog.getByTestId('pack-region')).toContainText('km²');

      // name, a small zoom range and only the pmtiles layer
      await dialog.getByLabel('Paketname').fill('Innenstadt');
      await dialog.getByLabel('Max. Zoom').fill('12');
      await dialog.getByLabel('Straßenkarte').uncheck();
      await dialog.getByRole('button', { name: 'Paket erstellen' }).click();
      await expect(page.getByText('Paket erstellt')).toBeVisible();
      const row = page.locator('[data-row-id=innenstadt]');
      await expect(row.getByTestId('pack-status')).toHaveAttribute('data-state', 'draft');
      await expect(page.getByTestId('publish-bar')).toBeVisible();

      // published: the build starts, and its state shows in the table (no network: it fails, with a reason)
      await publishFromLifecycle(page, KEY);
      await page.goto(`/admin/projects/${KEY}/settings?section=offline-packs`);
      await expect(row.getByTestId('pack-status')).not.toHaveAttribute('data-state', 'draft', {
        timeout: 30_000,
      });
      const listed = await page.request.get(`/api/admin/p/${KEY}/packs`);
      expect(listed.status()).toBe(200);
      expect(((await listed.json()) as { packs: { key: string }[] }).packs.map((p) => p.key)).toEqual([
        'innenstadt',
      ]);
      await expect(row.getByTestId('pack-status')).toHaveAttribute('data-state', 'failed', {
        timeout: 60_000,
      });
      await row.getByRole('button', { name: 'Neu bauen' }).click();
      await expect(page.getByText('Paket wird neu gebaut')).toBeVisible();

      // delete from the draft, with the confirm
      await row.getByRole('button', { name: 'Menü öffnen' }).click();
      await page.getByRole('menuitem', { name: 'Löschen' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByText('Paket gelöscht')).toBeVisible();
    });
  });
}
