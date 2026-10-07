import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';
import { publish } from '../support/publish';

/**
 * WP-386: Projekteinstellungen "Erststart", "Cluster" and "Filter & Felder" (v3 StartupSection, ClusterSection,
 * FieldFiltersSection) against the real built process, at phone (390x844) and desktop (1280x800) size. Each section
 * saves into the draft; after publishing, a participant's bootstrap carries the change: the layers on at start, the
 * tools active for the role, and the filter presets of the role.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
/** What the Kartenebenen page will write; this WP only flags layers, so the project starts with these. */
const LAYERS = {
  osm: {
    label: { de: 'Straßenkarte' },
    kind: 'base',
    source: { type: 'preset', preset: 'osm' },
    on_at_start: true,
  },
  luftbild: {
    label: { de: 'Luftbild' },
    kind: 'base',
    source: { type: 'xyz', url: 'https://tiles.example.org/luft/{z}/{x}/{y}.png' },
  },
  flur: {
    label: { de: 'Flurkarte' },
    kind: 'overlay',
    source: { type: 'xyz', url: 'https://tiles.example.org/flur/{z}/{x}/{y}.png' },
  },
};

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

const keyOf = (size: string): string => `erststart${size}`;
const pageOf = (size: string): string => `/admin/projects/${keyOf(size)}/settings`;
let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  createAdmin('erststart-deploy@example.org');
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  for (const size of SIZES) {
    const key = keyOf(size.name);
    expect(admin(['create-project', key, `Erststart ${size.name}`]).status).toBe(0);
    expect(admin(['add-membership', 'erststart-deploy@example.org', key, 'sachbearbeiter']).status).toBe(0);
  }
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'erststart-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  for (const size of SIZES) {
    const add = Object.fromEntries(Object.entries(LAYERS).map(([k, v]) => [`map.layers.${k}`, v]));
    const file = { ...(goldenData('projects/stadtwerke-meldungen.yaml') as object), add };
    const deploy = await ctx.post(`/api/admin/p/${keyOf(size.name)}/deploy`, { data: file });
    expect(await deploy.json()).toMatchObject({ ok: true });
  }
  await ctx.dispose();
});

async function signIn(page: Page, size: string): Promise<void> {
  const email = `erststart${(admins += 1)}@example.org`;
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
  file: {
    map?: { layers: Record<string, { on_at_start?: boolean }> };
    tools?: Record<string, unknown>;
    roles: Record<
      string,
      {
        app?: {
          tools?: Record<string, { availability?: string }>;
          filter_presets?: Record<string, { label: unknown; filters: Record<string, string> }>;
        };
      }
    >;
  };
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: Erststart, Cluster and Filter & Felder go into the draft, publish, the participant sees them', async ({
      page,
      playwright,
      baseURL,
    }) => {
      test.setTimeout(180_000); // a long journey on a loaded machine
      await signIn(page, size.name);
      const nav = page.getByRole('navigation', { name: 'Einstellungsbereiche' });

      // The sidebar lists the three sections where v3 had them.
      await page.goto(pageOf(size.name));
      await expect(nav.getByRole('button', { name: 'Erststart' })).toBeVisible();
      await expect(nav).toContainText('Funktionen');
      await expect(nav.getByRole('button', { name: 'Filter & Felder' })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'Cluster' })).toBeVisible();

      // Erststart: Luftbild is the base, Flurkarte is on; the section is in the URL and survives a reload.
      await nav.getByRole('button', { name: 'Erststart' }).click();
      await expect(page).toHaveURL(/[?&]section=startup/);
      await page.reload();
      await expect(page.getByRole('heading', { level: 2, name: 'Startstellungen' })).toBeVisible();
      await expect(page.getByLabel('Straßenkarte')).toBeChecked();
      await page.getByLabel('Luftbild').check();
      await page.getByLabel('Flurkarte').check();
      await page.getByRole('button', { name: 'Startstellungen speichern' }).click();
      await expect(page.getByText('Startstellungen gespeichert')).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeVisible();
      await page.reload();
      await expect(page.getByLabel('Luftbild')).toBeChecked();
      await expect(page.getByLabel('Flurkarte')).toBeChecked();

      // Cluster: one switch for all roles, then the role list says each role starts with it.
      await nav.getByRole('button', { name: 'Cluster' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Cluster' })).toBeVisible();
      const all = page.getByRole('switch', { name: 'Alle Rollen' });
      await expect(all).toHaveAttribute('aria-checked', 'false');
      await all.click();
      await expect(page.getByText('Startstellung gespeichert')).toBeVisible();
      await expect(all).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('tool-start-cluster').getByText('Beim Start an').first()).toBeVisible();

      // Filter & Felder: the Ansichten tool, then a preset built with the filter builder.
      await nav.getByRole('button', { name: 'Filter & Felder' }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Feld-Filter' })).toBeVisible();
      await page.getByTestId('tool-start-field_filters').getByRole('switch', { name: 'Alle Rollen' }).click();
      await expect(
        page.getByTestId('tool-start-field_filters').getByRole('switch', { name: 'Alle Rollen' }),
      ).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('Noch keine Presets.')).toBeVisible();
      await page.getByRole('button', { name: 'Neu' }).click();
      const dialog = page.getByTestId('preset-dialog');
      await expect(dialog.getByRole('heading', { name: 'Neues Preset' })).toBeVisible();
      // the dialog stays inside the screen and scrolls on a phone, so the buttons stay reachable
      const box = await dialog.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(size.width);
      expect(box?.height ?? 0).toBeLessThanOrEqual(size.height);
      await dialog.getByRole('button', { name: 'Speichern' }).click();
      await expect(dialog.getByText('Name fehlt')).toBeVisible();
      await dialog.getByLabel('Name').fill('Offene Meldungen');
      await dialog.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }).click();
      await dialog.getByRole('menuitem', { name: 'Stufe' }).click();
      await dialog.getByLabel('Objektart wählen…').selectOption({ label: 'Meldung' });
      await dialog.getByText('Offen', { exact: true }).click();
      await dialog.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Presets gespeichert')).toBeVisible();
      await expect(dialog).toBeHidden();
      const row = page.getByTestId('preset-list').locator('[data-preset="offene_meldungen"]');
      await expect(row).toContainText('1 Bedingung(en)');
      await expect(row).toContainText('Alle Rollen');

      // A second preset is edited and deleted again (the delete asks first).
      await page.getByRole('button', { name: 'Neu' }).click();
      await dialog.getByLabel('Name').fill('Zum Löschen');
      await dialog.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByTestId('preset-list').locator('[data-preset="zum_loeschen"]')).toBeVisible();
      await page.getByRole('button', { name: 'Preset Zum Löschen bearbeiten' }).click();
      await dialog.getByLabel('Handwerker').uncheck();
      await dialog.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Presets gespeichert').first()).toBeVisible();
      await expect(page.getByTestId('preset-list').locator('[data-preset="zum_loeschen"]')).toContainText(
        'Rollen: Melder, Sachbearbeitung',
      );
      await page.getByRole('button', { name: 'Preset Zum Löschen löschen' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByTestId('preset-list').locator('[data-preset="zum_loeschen"]')).toHaveCount(0);

      // Publish: the participant's bootstrap carries all three changes.
      await publish(page, { via: 'bar' });
      const ctx = await participant(playwright, baseURL ?? '', size.name);
      const bootstrap = (await (await ctx.get('/participant-api/bootstrap')).json()) as {
        compiled: Compiled;
      };
      const { file } = bootstrap.compiled;
      expect(file.map?.layers['luftbild']?.on_at_start).toBe(true);
      expect(file.map?.layers['flur']?.on_at_start).toBe(true);
      expect(file.map?.layers['osm']?.on_at_start).toBe(false);
      expect(file.tools).toHaveProperty('cluster');
      expect(file.tools).toHaveProperty('views');
      for (const tool of ['cluster', 'views']) {
        const entry = file.roles['melder']?.app?.tools?.[tool];
        expect(entry).toBeDefined();
        expect(entry?.availability).not.toBe('offered');
      }
      const preset = file.roles['melder']?.app?.filter_presets?.['offene_meldungen'];
      expect(preset?.label).toBe('Offene Meldungen');
      expect(preset?.filters['meldung']).toMatch(/self\.status in \["offen"\]/);
      expect(file.roles['melder']?.app?.filter_presets?.['zum_loeschen']).toBeUndefined();
      await ctx.dispose();

      // Switching the tools off again leaves them offered; the draft shows it.
      await page.goto(`${pageOf(size.name)}?section=cluster`);
      await page.getByRole('switch', { name: 'Alle Rollen' }).click();
      await expect(page.getByText('Startstellung gespeichert')).toBeVisible();
      await expect(
        page.getByTestId('tool-start-cluster').getByText('Angeboten, beim Start aus').first(),
      ).toBeVisible();
    });
  });
}
