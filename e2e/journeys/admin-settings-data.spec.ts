import { expect, test } from '@playwright/test';
import { waitsFor } from './lib/fixme';
import { PROJECT, adminSignIn, seedJourneyWorld } from './lib/world';

/**
 * Admin: project settings and the data of each Objektart (register a2-settings-data). v3 routes
 * /admin/projects/<project>/settings and /admin/projects/<project>/workflows/<id> (the data table). Labels from reference/messages/de.json.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedJourneyWorld(playwright, baseURL ?? '');
});

const BASE = `/admin/projects/${PROJECT}`;
const DATA = `${BASE}/workflows/baum`;

// Purpose: let the admin set up the project map: the first layer becomes the base layer, a preset saves the typing.
// v3: reference/src/routes/admin/projects/[projectId]/settings/sections/LayersSection.svelte:1-120   Taps in v3: 4
test.fixme('AS-01 Kartenebenen preset OSM', waitsFor('the admin project settings'), async ({ page }) => {
  await adminSignIn(page);
  await page.goto(`${BASE}/settings`);
  await page.getByRole('tab', { name: 'Kartenebenen' }).click();
  await page.getByRole('button', { name: 'Layer hinzufügen' }).click();
  await page.getByRole('button', { name: /OpenStreetMap/ }).click();
  const layer = page.getByRole('listitem').filter({ hasText: 'OpenStreetMap' });
  await expect(layer).toContainText('Basis-Layer');
});

// Purpose: let the admin choose where the map opens for everyone: latitude, longitude and zoom.
// v3: reference/src/routes/admin/projects/[projectId]/settings/sections/MapDefaultsSection.svelte:1-100   Taps in v3: 4
test.fixme(
  'AS-02 Standardansicht saves lat, lng and zoom',
  waitsFor('the admin project settings'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.goto(`${BASE}/settings`);
    await page.getByRole('textbox', { name: 'Breitengrad' }).fill('50.7');
    await page.getByRole('textbox', { name: 'Längengrad' }).fill('7.1');
    await page.getByRole('spinbutton', { name: 'Zoom' }).fill('15');
    await page.getByRole('button', { name: 'Standards speichern' }).click();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Breitengrad' })).toHaveValue('50.7');
  },
);

// Purpose: let the admin write an info page (Datenschutz, Impressum) that shows each participant their own login QR.
// v3: reference/src/lib/info-page-render.ts:10-13   Taps in v3: 5
test.fixme(
  'AS-03 Info-Seite with $qrloginlink',
  waitsFor('the admin project settings'),
  async ({ page, browser, baseURL }) => {
    await adminSignIn(page);
    await page.goto(`${BASE}/settings`);
    await page.getByRole('button', { name: 'Infoseite hinzufügen' }).click();
    await page.getByRole('textbox', { name: 'Titel' }).fill('Hilfe');
    await page.getByRole('textbox', { name: 'Inhalt' }).fill('<p>Zweites Gerät: $qrloginlink</p>');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Infoseite erfolgreich erstellt')).toBeVisible();
    // a participant sees the variable replaced by a QR image of their own login link
    const device = await browser.newPage({ baseURL: baseURL ?? '' });
    await device.goto('/map');
    await device.getByRole('button', { name: 'Einstellungen' }).click();
    await device.getByRole('button', { name: 'Hilfe' }).click();
    await expect(device.getByRole('img', { name: /QR/ })).toBeVisible();
  },
);

// Purpose: let the admin work any list of a type's features: search, click-to-sort, a distinct-value filter.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/+page.svelte:1-200   Taps in v3: 3
test.fixme(
  'AS-04 Data table: search, sort and filter',
  waitsFor('the admin data table'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.goto(DATA);
    const table = page.getByRole('table');
    await page.getByRole('searchbox', { name: 'Suchen' }).fill('Eiche');
    await expect(table.getByRole('row')).toHaveCount(2); // header and one match
    await page.getByRole('searchbox', { name: 'Suchen' }).clear();
    await table.getByRole('columnheader', { name: 'Vitalität' }).click();
    await expect(table.getByRole('columnheader', { name: 'Vitalität' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await table.getByRole('button', { name: 'Vitalität filtern' }).click();
    await page.getByRole('checkbox', { name: 'Vital' }).check();
    await expect(table.getByRole('row').nth(1)).toContainText('Vital');
  },
);

// Purpose: let the admin fix many values at once, cell by cell, with every change recorded as a run.
// v3: reference/src/routes/admin/projects/[projectId]/custom-tables/[tableId]/+page.svelte:1-100   Taps in v3: 4
// Owner decision: every edit is a run (R3), so the Aktivität of the row shows the admin as actor
test.fixme('AS-05 Edit mode saves as a run', waitsFor('the admin data table'), async ({ page }) => {
  await adminSignIn(page);
  await page.goto(DATA);
  await page.getByRole('switch', { name: 'Bearbeitungsmodus' }).click();
  await page.getByRole('cell', { name: 'Vital' }).first().click();
  await page.getByRole('combobox').selectOption({ label: 'Geschwächt' });
  await page.getByRole('switch', { name: 'Bearbeitungsmodus' }).click();
  await expect(page.getByRole('cell', { name: 'Geschwächt' }).first()).toBeVisible();
});

// Purpose: let the admin open one feature in full: its Daten, its Aktivität and the run protocol.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/instances/[instanceId]/+page.svelte:1-100   Taps in v3: 2
test.fixme(
  'AS-06 Row opens the detail with Aktivität',
  waitsFor('the admin data table'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.goto(DATA);
    await page.getByRole('row').nth(1).click();
    await expect(page).toHaveURL(/\/instances\//);
    await page.getByRole('tab', { name: 'Aktivität' }).click();
    await expect(page.getByRole('listitem').first()).toContainText('Erfassen');
  },
);

// Purpose: let the admin load a list from a spreadsheet: map the columns, check the preview, import all or nothing.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/+page.svelte:1-200   Taps in v3: 6
// Owner decision: the import is a run; replace-all is all or nothing (rebuild.md: import as runs)
test.fixme(
  'AS-07 CSV import wizard with preview and replace-all',
  waitsFor('the admin data table'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.goto(DATA);
    await page.getByRole('button', { name: 'CSV importieren' }).click();
    await page.getByLabel('Datei').setInputFiles({
      name: 'baeume.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('art,vitalitaet\nEiche,v1\nBuche,x-ungueltig\n'),
    });
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.getByRole('heading', { name: 'Vorschau' })).toBeVisible();
    await page.getByRole('checkbox', { name: /Alle vorhandenen Daten ersetzen/ }).check();
    await page.getByRole('button', { name: 'Importieren' }).click();
    // one invalid row refuses the whole file: nothing changed
    await expect(page.getByRole('alert')).toContainText('x-ungueltig');
    await page.goto(DATA);
    await expect(page.getByRole('row').nth(1)).not.toContainText('Eiche');
  },
);
