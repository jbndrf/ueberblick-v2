import { expect, test } from '@playwright/test';
import { waitsFor } from './lib/fixme';
import { PROJECT, adminSignIn, seedJourneyWorld } from './lib/world';

/**
 * Admin: the builder and the deploy (register a3-builder). v3 routes
 * /admin/projects/<project>/workflows/<id>/builder (canvas, task pane, form editor, Modell, rules), .../fork (the deploy
 * overview) and .../settings (Versionen). One process per Objektart; the owner's words are Objektart, Objekt, Regel, Aufgabe.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedJourneyWorld(playwright, baseURL ?? '');
});

const BASE = `/admin/projects/${PROJECT}`;
const BUILDER = `${BASE}/workflows/baum/builder`;

// Purpose: let the admin model the process of an Objektart: drag a stage onto the canvas and name it.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/builder/catalog/CatalogSidebar.svelte:112-129   Taps in v3: 4
test.fixme('AB-01 Builder: add stage', waitsFor('the workflow builder'), async ({ page }) => {
  await adminSignIn(page);
  await page.goto(BUILDER);
  await page.getByRole('button', { name: 'Stage' }).click();
  await page.getByRole('textbox', { name: 'Titel' }).fill('Prüfung');
  await page.getByRole('radio', { name: 'Zwischenschritt' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('group', { name: 'Prüfung' })).toBeVisible();
});

// Purpose: let the admin give a stage a button for the next step and drag its dot to the stage it leads to.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/builder/task-canvas/TaskToolbarList.svelte:215   Taps in v3: 4
test.fixme(
  'AB-02 Builder: add a task button and drag its dot to a stage',
  waitsFor('the workflow builder'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.goto(BUILDER);
    const from = page.getByRole('group', { name: 'Neu' });
    await from.getByRole('button', { name: 'Button hinzufügen' }).click();
    await page.getByRole('textbox', { name: 'Beschriftung' }).fill('Prüfen');
    const dot = from.getByRole('button', { name: 'Prüfen verbinden' });
    await dot.dragTo(page.getByRole('group', { name: 'Prüfung' }));
    await expect(page.getByRole('img', { name: 'Prüfen führt nach Prüfung' })).toBeVisible();
  },
);

// Purpose: let the admin build the form of a task: pages, properties dragged in, labels and hints.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/builder/right-sidebar/views/form-editor/FieldConfigPanel.svelte:557   Taps in v3: 6
test.fixme(
  'AB-03 Form editor: add a page and a property',
  waitsFor('the workflow builder'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.goto(BUILDER);
    await page.getByRole('button', { name: 'Befund ergänzen' }).click();
    await page.getByRole('button', { name: 'Formular bearbeiten' }).click();
    await page.getByRole('button', { name: 'Seite hinzufügen' }).click();
    await page
      .getByRole('button', { name: 'Text' })
      .dragTo(page.getByRole('region', { name: 'Formularvorschau' }));
    await page.getByRole('textbox', { name: 'Bezeichnung' }).fill('Bemerkung');
    await expect(page.getByRole('region', { name: 'Formularvorschau' })).toContainText('Bemerkung');
  },
);

// Purpose: let the admin say, while building a form, which roles see or edit a property, right on that property.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/builder/right-sidebar/views/form-editor/FieldConfigPanel.svelte:680-691   Taps in v3: 4
// Owner decision: roles are set on the property in context; the matrix is the overview (rebuild.md §3, "Settings sit where the work happens")
test.fixme('AB-04 Roles on the property', waitsFor('the workflow builder'), async ({ page }) => {
  await adminSignIn(page);
  await page.goto(BUILDER);
  await page.getByRole('button', { name: 'Befund ergänzen' }).click();
  await page.getByRole('button', { name: 'Formular bearbeiten' }).click();
  await page.getByRole('button', { name: 'Bemerkung' }).click();
  await page.getByRole('combobox', { name: 'Sichtbar für Rollen' }).selectOption({ label: 'kontrolle' });
  await page.getByRole('combobox', { name: 'Bearbeitbar für Rollen' }).selectOption({ label: 'kontrolle' });
  await page.getByRole('button', { name: 'Speichern' }).click();
});

// Purpose: let the admin check and change permissions in bulk: roles against the properties they may see or write.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/builder/model/permissions/PermissionsMatrixView.svelte:1-100   Taps in v3: 3
test.fixme('AB-05 Permission matrix shows the same', waitsFor('the workflow builder'), async ({ page }) => {
  await adminSignIn(page);
  await page.goto(BUILDER);
  await page.getByRole('button', { name: 'Modell' }).click();
  await page.getByRole('tab', { name: 'Berechtigungen' }).click();
  // the role set on the property in AB-04 is the same role set here (matrix cells are named "<Rolle>: <Feld> (Bearbeiten)", WP-331)
  await expect(page.getByRole('checkbox', { name: 'kontrolle: Bemerkung (Bearbeiten)' })).toBeChecked();
});

// Purpose: let the admin automate a step: a Regel with a trigger, conditions and actions.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/builder/task-canvas/AutomationConfig.svelte:316-607   Taps in v3: 6
test.fixme('AB-06 Add a Regel with a trigger', waitsFor('the workflow builder'), async ({ page }) => {
  await adminSignIn(page);
  await page.goto(BUILDER);
  await page.getByRole('button', { name: 'Regel' }).click();
  await page.getByRole('combobox', { name: 'Auslöser' }).selectOption({ label: 'Aufgabe abgeschlossen' });
  await page.getByRole('button', { name: 'Wenn (Bedingungen)' }).click();
  await page.getByRole('button', { name: 'Dann (Aktionen)' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('group', { name: 'Regel' })).toBeVisible();
});

// Purpose: let the admin try the draft as a role, with demo data, before it goes live; preview logins open it on a phone.
// v3: reference/src/routes/admin/projects/[projectId]/workflows/[workflowId]/builder/right-sidebar/views/stage-preview/ParticipantPreview.svelte:64-70   Taps in v3: 3
// Owner decision: the preview is v3's draft with demo data and preview logins, discarded on deploy (rebuild.md §3)
test.fixme(
  'AB-07 Preview with demo data and a preview login',
  waitsFor('the builder preview'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.goto(BUILDER);
    await page.getByRole('combobox', { name: 'Alle Rollen' }).selectOption({ label: 'kontrolle' });
    // buttons the role cannot use are dimmed
    await expect(page.getByRole('button', { name: 'Massnahme erledigen' })).toBeDisabled();
    await page.getByRole('button', { name: 'Vorschau-Logins' }).click();
    await expect(page.getByRole('img', { name: /QR/ })).toBeVisible();
  },
);

// Purpose: let the admin deploy a changed template without fighting existing data: decide where features of a removed stage go.
// v3: reference/src/routes/admin/projects/[projectId]/fork/+page.svelte:182-312   Taps in v3: 5
// Owner decision: values move on deploy (supersedes A-024); the deploy overview shows affected counts (rebuild.md step 4);
// v3's fork page is obsolete (owner decision 18, comparison.md section 10): the overview opens from the builder toolbar "Live schalten" (a3 row 94)
test.fixme(
  'AB-08 Deploy overview: removed stage, verschieben nach, features moved',
  waitsFor('the deploy overview'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.goto(BUILDER);
    await page.getByRole('button', { name: 'Live schalten' }).click();
    const type = page.getByRole('region', { name: 'Baum' });
    await expect(type.getByText(/Phase\(n\) entfernt/)).toBeVisible();
    await type.getByRole('combobox', { name: 'verschieben nach' }).selectOption({ label: 'Vital' });
    await page.getByRole('button', { name: 'Live schalten' }).last().click();
    await expect(page.getByText(/Objekte verschoben/)).toBeVisible();
    // the features sit in the new stage afterwards
    await page.goto(`${BASE}/workflows/baum`);
    await expect(page.getByRole('row').nth(1)).toContainText('Vital');
    // the same overview is reachable from Versionen
    await page.goto(`${BASE}/releases`);
    await page.getByRole('button', { name: 'Zurückrollen' }).first().click();
    await expect(page.getByRole('button', { name: 'Live schalten' })).toBeVisible();
  },
);

// Purpose: let the admin go back to an earlier version of the project when a deploy was a mistake.
// v3: reference/src/routes/admin/projects/[projectId]/releases/+page.svelte:1-40 (a read-only history, no rollback)   Taps in v3: none
// Owner decision: a3-builder decision 8, row 100
test.fixme('AB-09 Versionen: rollback', waitsFor('the deploy overview'), async ({ page }) => {
  await adminSignIn(page);
  await page.goto(`${BASE}/releases`);
  const before = await page.getByRole('row').count();
  // a rollback is a deploy: Zurückrollen opens the same deploy overview, Live schalten confirms
  await page.getByRole('row').nth(2).getByRole('button', { name: 'Zurückrollen' }).click();
  await page.getByRole('button', { name: 'Live schalten' }).click();
  await expect(page.getByRole('row').first()).toContainText('aktiv');
  expect(await page.getByRole('row').count()).toBeGreaterThanOrEqual(before);
});
