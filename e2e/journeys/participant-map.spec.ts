import { expect, test, type Page } from '@playwright/test';
import { waitsFor } from './lib/fixme';
import { seedJourneyWorld, signInByLink } from './lib/world';

/**
 * The participant map (register p2-map): v3 route /map with the core bar Filter, Layer, Standort, +, Werkzeuge,
 * Einstellungen. Labels from reference/messages/de.json; the Objektart pills use the owner's word for v3's "workflow".
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedJourneyWorld(playwright, baseURL ?? '');
});

/** v3's "Neuer Workflow" button; the owner's glossary renames the word (Objektart), the button keeps the plus. */
const NEW = /^Neu/;

async function openMap(page: Page): Promise<void> {
  await signInByLink(page);
  await expect(page).toHaveURL(/\/map$/);
}

// Purpose: let a participant orient on the map at the admin's start view and see the core controls.
// v3: reference/src/routes/(participant)/map/components/MapCanvas.svelte:1000-1006   Taps in v3: 0
test.fixme('PM-01 Open the map', waitsFor('the participant map'), async ({ page }) => {
  await openMap(page);
  for (const name of ['Filter', 'Layer', 'Standort', 'Werkzeuge', 'Einstellungen'])
    await expect(page.getByRole('button', { name })).toBeVisible();
  await expect(page.getByRole('button', { name: NEW })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Karte' })).toBeVisible();
});

// Purpose: let a participant switch the basemap or an overlay.
// v3: reference/src/routes/(participant)/map/components/LayerSheet.svelte:1-120   Taps in v3: 2
test.fixme('PM-02 Layer switches the basemap', waitsFor('the participant map'), async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: 'Layer' }).click();
  await page.getByRole('radio', { name: 'Satellit' }).click();
  await expect(page.getByRole('radio', { name: 'Satellit' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Karte' })).toHaveAttribute('data-basemap', 'satellit');
});

// Purpose: let a participant narrow down what the map shows, per Objektart and per stage or value, with live counts.
// v3: reference/src/routes/(participant)/map/components/FilterSheet.svelte:365-473   Taps in v3: 3
test.fixme('PM-03 Filter type and stage switches', waitsFor('the participant map'), async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: 'Filter' }).click();
  const sheet = page.getByRole('dialog', { name: 'Karteninhalt' });
  const baum = sheet.getByRole('switch', { name: 'Baum' });
  await expect(baum).toBeChecked();
  await sheet.getByRole('button', { name: 'Baum aufklappen' }).click();
  await sheet.getByRole('switch', { name: 'Vital' }).click();
  await expect(page.getByTestId('map-feature-count')).toHaveText('0');
  await baum.click();
  await expect(baum).not.toBeChecked();
});

// Purpose: let a participant start from the filter the admin prepared for their role.
// v3: reference/src/routes/(participant)/map/components/FilterSheet.svelte:608-629   Taps in v3: 4
test.fixme(
  'PM-04 Filter loads the admin preset for the role',
  waitsFor('the participant map'),
  async ({ page }) => {
    await openMap(page);
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('tab', { name: 'Ansichten' }).click();
    await page.getByRole('button', { name: 'Laden' }).click();
    await page.getByRole('menuitem', { name: 'Vom Projekt' }).click();
    // the preset is copied into a new personal view, and that view is the active one
    await expect(page.getByRole('tab', { name: 'Ansichten' })).toBeVisible();
    await expect(page.getByText('Aktive Ansicht')).toBeVisible();
  },
);

// Purpose: let a participant create a feature at a position: pick the Objektart, place the pin, fill the form, send.
// v3: reference/src/routes/(participant)/map/components/WorkflowSelector.svelte:360-416   Taps in v3: 4
// Owner decision: v3's "Neuer Workflow" and its workflow pills are Objektart (glossary); the flow is v3's
test.fixme(
  'PM-05 Plus, Objektart, pin, form, Absenden',
  waitsFor('the participant map'),
  async ({ page }) => {
    await openMap(page);
    await page.getByRole('button', { name: NEW }).click();
    await page.getByRole('button', { name: 'Baum erfassen' }).click();
    // a draggable pin sits at the map centre with a confirm pill labelled with the Objektart
    await expect(page.getByRole('img', { name: 'Pin' })).toBeVisible();
    await page.getByRole('button', { name: 'Baum erfassen' }).click();
    await page.getByRole('combobox', { name: 'Vitalität' }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Absenden' }).click();
    // the sheet switches to the new feature, and its type is switched visible in the filter
    await expect(page.getByRole('dialog', { name: /Baum/ })).toBeVisible();
    await expect(page.getByText('Wartet auf Übertragung')).toBeVisible();
  },
);

// Purpose: let a participant draw a line or polygon feature on the map, with several parts.
// v3: reference/src/lib/components/map/geometry-draw-tool.svelte:1-200   Taps in v3: 9
test.fixme('PM-06 Draw a polygon with several parts', waitsFor('the participant map'), async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: NEW }).click();
  await page.getByRole('button', { name: 'Fläche erfassen' }).click();
  const map = page.getByRole('region', { name: 'Karte' });
  for (const [x, y] of [
    [80, 80],
    [200, 80],
    [200, 200],
  ] as const)
    await map.click({ position: { x, y } });
  await map.click({ position: { x: 80, y: 80 } }); // closes on the first vertex
  await page.getByRole('button', { name: 'Neues Element' }).click();
  for (const [x, y] of [
    [260, 260],
    [320, 260],
    [320, 320],
  ] as const)
    await map.click({ position: { x, y } });
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await map.click({ position: { x: 260, y: 320 } });
  await page.getByRole('button', { name: 'Fertig' }).click();
  await page.getByRole('button', { name: 'Absenden' }).click();
  await expect(page.getByRole('dialog', { name: /Fläche/ })).toBeVisible();
});

// Purpose: let a participant find the last edited features, also those without geometry, and go there.
// v3: reference/src/routes/(participant)/map/+page.svelte:2419-2442   Taps in v3: 3
test.fixme('PM-07 Zuletzt flies to a feature', waitsFor('the participant map'), async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: NEW }).dblclick(); // the second tap on + opens Zuletzt
  const recent = page.getByRole('dialog', { name: 'Zuletzt' });
  await recent.getByRole('button').first().click();
  // the feature sheet opens and the list stays open
  await expect(page.getByRole('dialog', { name: /Baum/ })).toBeVisible();
  await expect(recent).toBeVisible();
});
