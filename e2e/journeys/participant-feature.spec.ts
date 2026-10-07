import { expect, test, type Page } from '@playwright/test';
import { waitsFor } from './lib/fixme';
import { PROJECT, issueToken, seedJourneyWorld, serverRuns, signInApi, signInByLink } from './lib/world';

/**
 * Feature sheet, tasks and forms (register p3-feature-forms): tap a feature on /map, the peek sheet opens on
 * "Aktivität"; tasks, forms with pages, quick edit, photos, refused and unsent runs. Labels from reference/messages/de.json.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedJourneyWorld(playwright, baseURL ?? '');
});

async function openFeature(page: Page): Promise<void> {
  await signInByLink(page);
  await expect(page).toHaveURL(/\/map$/);
  await page.getByRole('button', { name: /Baum/ }).first().click();
  await expect(page.getByRole('dialog', { name: /Baum/ })).toBeVisible();
}

// Purpose: let a task run from any device reach the office: the whole write path from the client to the server.
// v3: reference/src/routes/(participant)/map/modules/task-runs/TaskRunQueueList.svelte:26-71   Taps in v3: 4
test('PF-01 A submitted task reaches the server [harness proof]', async ({ playwright, baseURL }) => {
  // no participant screen exists yet that v3's journey can use, so the API takes the screen's place
  const api = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await signInApi(api, issueToken());
  const run = await api.post(`/api/p/${PROJECT}/runs`, {
    data: {
      id: '00000000-0000-7000-8000-0000000000f1',
      task: 'erfassen',
      configVersion: 1,
      input: { geometrie: { type: 'Point', coordinates: [7.2, 50.8] }, vitalitaet: 'v2' },
    },
  });
  expect(run.status()).toBe(200);
  await expect.poll(() => serverRuns('erfassen').map((r) => r.outcome)).toContain('accepted');
  await api.dispose();
});

// Purpose: let a participant look at a feature: the peek sheet opens on Aktivität, Daten shows the values.
// v3: reference/src/routes/(participant)/map/modules/workflow-instance-detail/WorkflowInstanceDetailModule.svelte:156-261   Taps in v3: 2
test.fixme(
  'PF-02 Open a feature in the peek sheet',
  waitsFor('the participant feature sheet'),
  async ({ page }) => {
    await openFeature(page);
    const sheet = page.getByRole('dialog', { name: /Baum/ });
    await expect(sheet.getByRole('tab', { name: 'Aktivität', selected: true })).toBeVisible();
    await sheet.getByRole('tab', { name: 'Daten' }).click();
    await expect(sheet.getByText('Vitalität')).toBeVisible();
  },
);

// Purpose: let a participant move a feature one step on with a single tap (a task without fields).
// v3: reference/src/routes/(participant)/map/modules/workflow-instance-detail/WorkflowInstanceDetailModule.svelte:620-627   Taps in v3: 1
test.fixme(
  'PF-03 Run a no-field task in one tap',
  waitsFor('the participant feature sheet'),
  async ({ page }) => {
    await openFeature(page);
    await page.getByRole('button', { name: 'Erledigt' }).click();
    // queued at once: the timeline shows the move and the badge
    await expect(page.getByText(/Verschoben nach:/)).toBeVisible();
    await expect(page.getByText('Wartet auf Übertragung')).toBeVisible();
  },
);

// Purpose: let a participant fill in a task's form with several pages, and be told what is still missing.
// v3: reference/src/routes/(participant)/map/modules/workflow-instance-detail/tools/FormFillTool.svelte:274-293   Taps in v3: 4
test.fixme(
  'PF-04 Run a form task with pages',
  waitsFor('the participant feature sheet'),
  async ({ page }) => {
    await openFeature(page);
    await page.getByRole('button', { name: 'Befund ergänzen' }).click();
    await page.getByRole('button', { name: 'Absenden' }).click();
    // validation jumps to the first page with errors and counts what is missing
    await expect(page.getByRole('tab', { name: /fehlen/ })).toBeVisible();
    await page.getByRole('textbox', { name: 'Befund' }).fill('Totholz im Kronenbereich');
    await page.getByRole('tab', { name: /Seite 2/ }).click();
    await page.getByRole('button', { name: 'Absenden' }).click();
    await expect(page.getByText('Totholz im Kronenbereich')).toBeVisible();
  },
);

// Purpose: let a participant correct a value in place, without walking through a form.
// v3: reference/src/routes/(participant)/map/modules/workflow-instance-detail/WorkflowInstanceDetailModule.svelte:612-618   Taps in v3: 3
test.fixme('PF-05 Quick edit in Daten', waitsFor('the participant feature sheet'), async ({ page }) => {
  await openFeature(page);
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  // Daten opens with the task's properties editable; only changed values are submitted
  await page.getByRole('textbox', { name: 'Stammumfang' }).fill('120');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Wartet auf Übertragung')).toBeVisible();
  await page.getByRole('tab', { name: 'Daten' }).click();
  await expect(page.getByText('120')).toBeVisible();
});

// Purpose: let a participant attach photos to a feature in the field, several per property, and see them afterwards.
// v3: reference/src/lib/components/form-renderer/MediaGallery.svelte:40-141   Taps in v3: 4
test.fixme('PF-06 Photo with Camera', waitsFor('photos end to end'), async ({ page }) => {
  await openFeature(page);
  await page.getByRole('button', { name: 'Befund ergänzen' }).click();
  // the file chooser is mocked: two small images
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Camera' }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgo=', 'base64') },
    { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgo=', 'base64') },
  ]);
  await expect(page.getByRole('img', { name: /a\.png/ })).toBeVisible();
  await page.getByRole('button', { name: 'Absenden' }).click();
  // afterwards the thumbnails are in Daten, and a tap opens the lightbox
  await page.getByRole('tab', { name: 'Daten' }).click();
  await page.getByRole('img', { name: /a\.png/ }).click();
  await expect(page.getByRole('dialog', { name: 'Bild' })).toBeVisible();
});

// Purpose: let a participant see who did which task on a feature and when, from the device's own copy of the log.
// v3: reference/src/routes/(participant)/map/modules/workflow-instance-detail/WorkflowInstanceDetailModule.svelte:156-261   Taps in v3: 2
// Owner decision: who is shown follows the admin's per-role name setting (register p3 engine gaps: run details in the sync)
test.fixme(
  'PF-07 Aktivität shows who, which task and when',
  waitsFor('run details in the sync'),
  async ({ page, context }) => {
    await openFeature(page);
    await context.setOffline(true); // the timeline is computed on the device
    const entry = page.getByRole('listitem').filter({ hasText: 'Erfassen' }).first();
    await expect(entry).toContainText('Anna');
    await expect(entry.getByRole('time')).toBeVisible();
  },
);

// Purpose: let a participant understand why the server refused a change and decide: send again, discard or edit.
// v3: reference/src/routes/(participant)/map/modules/task-runs/TaskRunNotices.svelte:75   Taps in v3: 2
test.fixme(
  'PF-08 A refused run: Erneut senden, Verwerfen, Bearbeiten',
  waitsFor('the participant feature sheet'),
  async ({ page }) => {
    await openFeature(page);
    const box = page.getByRole('alert').filter({ hasText: 'Vom Server abgelehnt' });
    // the box names the task and gives the reason with the property label
    await expect(box).toContainText('Befund ergänzen');
    await box.getByRole('button', { name: 'Erneut senden' }).click();
    await expect(box.getByRole('button', { name: 'Verwerfen' })).toBeVisible();
    await box.getByRole('button', { name: 'Bearbeiten' }).click();
    await expect(page.getByRole('textbox', { name: 'Befund' })).toBeVisible();
    await page.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(box).toBeHidden();
  },
);

// Purpose: let a participant find the feature behind an unsent change in the pending list and jump to it.
// v3: reference/src/routes/(participant)/map/components/SettingsSheet.svelte:401-497   Taps in v3: 3
test.fixme(
  'PF-09 An unsent change jumps to its feature',
  waitsFor('the participant settings'),
  async ({ page, context }) => {
    await openFeature(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Erledigt' }).click();
    await page.getByRole('button', { name: 'Einstellungen' }).click();
    await page.getByRole('button', { name: /Erledigt/ }).click();
    await expect(page.getByRole('dialog', { name: /Baum/ })).toBeVisible();
  },
);
