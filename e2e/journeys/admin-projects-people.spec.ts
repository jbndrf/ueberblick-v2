import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { waitsFor } from './lib/fixme';
import { PROJECT, adminSignIn, seedJourneyWorld } from './lib/world';

/**
 * Admin: sign-in, projects, people, roles and relations (register a1-projects-people). v3 routes /admin/login,
 * /admin/projects and /admin/projects/<project>/{participants,roles,relations}. Labels from reference/messages/de.json.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedJourneyWorld(playwright, baseURL ?? '');
});

const BASE = `/admin/projects/${PROJECT}`;

// Purpose: let the admin sign in with e-mail and password and stay signed in on a trusted device.
// v3: reference/src/routes/admin/login/+page.server.ts:25-71   Taps in v3: 4
// Owner decision: no TOTP step (comparison §10: TOTP is optional and off by default)
test.fixme(
  'AP-01 Admin signs in without TOTP and stays signed in 30 days',
  waitsFor('the admin sign-in'),
  async ({ page, context }) => {
    await adminSignIn(page, { remember: true });
    await expect(page.getByRole('heading', { name: 'Projekte' })).toBeVisible();
    const session = (await context.cookies()).find((c) => /session|auth/i.test(c.name));
    // "30 Tage angemeldet bleiben": the cookie lives about 30 days
    expect((session?.expires ?? 0) - Date.now() / 1000).toBeGreaterThan(29 * 86400);
  },
);

// Purpose: let the admin start a new project from a Vorlage, so it comes with Objektarten, Aufgaben and roles.
// v3: reference/src/routes/admin/projects/new/+page.server.ts:45-65   Taps in v3: 4
// Owner decision: projects are created from a template version (rebuild.md step 3: project creation from a template)
test.fixme(
  'AP-02 Projekt erstellen with a Vorlage',
  waitsFor('the admin projects page'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.getByRole('link', { name: 'Projekt erstellen' }).click();
    await page.getByRole('textbox', { name: 'Projektname' }).fill('Testgemeinde');
    await page.getByRole('combobox', { name: 'Vorlage' }).selectOption({ label: 'Baumkataster' });
    await page.getByRole('button', { name: 'Projekt erstellen' }).click();
    // the admin lands on the empty Teilnehmende page
    await expect(page).toHaveURL(/\/participants$/);
    await expect(page.getByRole('heading', { name: 'Teilnehmende' })).toBeVisible();
  },
);

/** The inline add row of the Teilnehmende table (v3 `inlineRowCreation`): the cell of a column, clicked open. */
const addRow = (page: Page) => page.locator('[data-add-row]');

/** Types a name into the add row's Name cell. */
async function typeName(page: Page, name: string): Promise<void> {
  await addRow(page).getByRole('button', { name: '-' }).first().click();
  await addRow(page).getByRole('textbox').fill(name);
  await page.keyboard.press('Enter');
}

/** Picks an option of the open Rollen picker: v3's MultiSelect is a dropdown of options on desktop and a full-screen dialog of checkboxes on a phone. */
async function pickRole(page: Page, label: string): Promise<void> {
  const phone = page.getByRole('dialog', { name: 'Optionen auswählen' });
  await page
    .getByRole('option', { name: label })
    .or(phone.getByRole('checkbox', { name: label, exact: true }))
    .click();
  await closePicker(page);
}

/** Closes the picker ("Fertig" on a phone, Escape on desktop). */
async function closePicker(page: Page): Promise<void> {
  const phone = page.getByRole('dialog', { name: 'Optionen auswählen' });
  if (await phone.isVisible()) await phone.getByRole('button', { name: /^Fertig/ }).click();
  else await page.keyboard.press('Escape');
}

/** Types a new role name into the open picker and creates it (Enter). */
async function typeRole(page: Page, label: string): Promise<void> {
  await page.getByRole('textbox', { name: /suchen/i }).fill(label);
  // the role is made by the server (it goes into the draft); close the picker once it is there and picked
  const made = page.waitForResponse((r) => r.url().includes('/participants/roles'));
  await page.keyboard.press('Enter');
  await made;
  await closePicker(page);
}

/** Opens the Rollen picker of the add row (v3: MultiSelect; a full-screen dialog on a phone, a dropdown on desktop). */
async function openRoles(page: Page): Promise<void> {
  await addRow(page).getByRole('button', { name: 'Rollen auswählen oder suchen...' }).click();
  await page.getByRole('button', { name: /^Auswählen oder suchen/ }).click();
}

// Purpose: let the admin put a field worker on the project with a name and roles, and get a login for them.
// v3: reference/src/routes/admin/projects/[projectId]/participants/+page.svelte:97-114   Taps in v3: 4
// Owner decision: Q12 the name is required and the id is generated; WP-607 the token is made at once and is readable
test('AP-03 Teilnehmende: add a participant with name and roles', async ({ page }, testInfo) => {
  const name = `Berta ${testInfo.project.name}`;
  await adminSignIn(page);
  await page.goto(`${BASE}/participants`);
  await expect(page.getByRole('heading', { name: 'Teilnehmende' })).toBeVisible();
  await typeName(page, name);
  await openRoles(page);
  await pickRole(page, 'Baumkontrolle');
  await addRow(page).getByRole('button', { name: 'Speichern' }).click();
  await addRow(page).getByRole('button', { name: 'Zeile hinzufügen' }).click();
  await expect(page.getByText('Teilnehmende erfolgreich erstellt')).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('Baumkontrolle');
  await expect(row.getByRole('button', { name: 'Kopieren' })).toBeVisible();
});

// Purpose: let the admin create a role on the spot while assigning roles, without leaving the row.
// v3: reference/src/routes/admin/projects/[projectId]/participants/+page.svelte:277-284   Taps in v3: 3
// Owner decision: Q13 a role typed here goes into the draft of the project file (published with the next Veröffentlichen)
test('AP-04 Create a role inline from the participant row', async ({ page }, testInfo) => {
  const name = `Chris ${testInfo.project.name}`;
  const role = `Praktikum ${testInfo.project.name}`;
  await adminSignIn(page);
  await page.goto(`${BASE}/participants`);
  await typeName(page, name);
  await openRoles(page);
  await typeRole(page, role);
  await addRow(page).getByRole('button', { name: 'Speichern' }).click();
  await addRow(page).getByRole('button', { name: 'Zeile hinzufügen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText(role);
  // the role is in the draft, and offered again on the next load
  const draft = (await (await page.request.get(`/builder-api/${PROJECT}/draft`)).json()) as {
    overlay: string;
  };
  expect(draft.overlay).toContain(`roles.praktikum_${testInfo.project.name}`);
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText(role);
});

// Purpose: let the admin hand out logins on paper: tick people, export one PDF of QR codes, print it.
// v3: reference/src/lib/utils/qr-pdf-export.ts:9-56   Taps in v3: 3
// Owner decision: §10.2 and §10.21 the QR holds the login link (a phone camera opens it), not the raw token
test('AP-05 QR exportieren for a selection, 8 per page', async ({ page }) => {
  await adminSignIn(page);
  await page.goto(`${BASE}/participants`);
  // enough people for a second page: the roster has Anna and the two of the journeys above; add seven more as the add row would
  await page.evaluate(async (project) => {
    for (let i = 0; i < 7; i++)
      await fetch(`/api/admin/p/${project}/participants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `Teilnehmer ${i}`, roles: [] }),
      });
  }, PROJECT);
  await page.reload();
  await page.getByRole('checkbox', { name: 'Alle auswählen' }).check();
  const button = page.getByRole('button', { name: /QR exportieren \(\d+\)/ });
  const selected = Number(/\((\d+)\)/.exec((await button.textContent()) ?? '')?.[1]);
  expect(selected).toBeGreaterThanOrEqual(8);
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  // A4, 8 codes per page (qr-pdf-export.ts): n selected give ceil(n / 8) pages
  const bytes = (await readFile(await file.path())).toString('latin1');
  expect(bytes.startsWith('%PDF')).toBe(true);
  expect(bytes.match(/\/Type\s*\/Page(?![s\w])/g)?.length).toBe(Math.ceil(selected / 8));
  await expect(page.getByText('QR-Code PDF erfolgreich exportiert')).toBeVisible();
});

// Purpose: let the admin open a role to the public with a join link, so citizens join without an account.
// v3: reference/src/routes/admin/projects/[projectId]/roles/+page.svelte:324-336   Taps in v3: 4
test.fixme(
  'AP-06 Rollen: Selbstbeitritt switch and join link',
  waitsFor('the admin people pages'),
  async ({ page }) => {
    await adminSignIn(page);
    await page.goto(`${BASE}/roles`);
    const row = page.getByRole('row', { name: /kontrolle/ });
    await row.getByRole('switch', { name: 'Selbstbeitritt' }).click();
    await row.getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Beitritts-URL & Voreinstellungen anzeigen' }).click();
    await expect(page.getByRole('textbox', { name: 'Beitritts-URL' })).toHaveValue(/\/join\/[\w-]+$/);
    await page.getByRole('spinbutton', { name: /Max\. Arbeitsabläufe pro Teilnehmer:in/ }).fill('5');
    await page.getByRole('button', { name: 'Speichern' }).click();
  },
);

// Purpose: let the admin link two Objektarten (Baum and Maßnahme), so related features can be opened and created from each other.
// v3: reference/src/routes/admin/projects/[projectId]/relations/+page.server.ts:97-143   Taps in v3: 6
test.fixme('AP-07 Beziehungen dialog', waitsFor('the admin people pages'), async ({ page }) => {
  await adminSignIn(page);
  await page.goto(`${BASE}/relations`);
  await page.getByRole('button', { name: '+ Beziehung erstellen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Maßnahmen am Baum');
  await dialog.getByRole('combobox', { name: 'Eltern-Objektart' }).selectOption({ label: 'Baum' });
  await dialog.getByRole('combobox', { name: 'Kind-Objektart' }).selectOption({ label: 'Maßnahme' });
  await dialog.getByRole('combobox', { name: 'Multiplizität' }).selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('row', { name: /Maßnahmen am Baum/ })).toBeVisible();
});
