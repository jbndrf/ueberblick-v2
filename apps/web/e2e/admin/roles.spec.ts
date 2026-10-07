import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs, uniqueEmail } from './sign-in';

/**
 * WP-346: the Rollen page (v3 `roles/+page.svelte`) against the real built process, at phone (390x844) and desktop
 * (1280x800) size: the roles with their participant counts, a role created inline (name and description) that lands in
 * the draft and brings the publish bar, rename, "Teilnehmende bearbeiten" with a person typed into the picker, and delete.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });

/** One project per round: a repeat or retry of this file must not meet the leftovers of the round before. */
let KEY = '';
let PAGE = '';
let admins = 0;
let deployer = '';

test.beforeAll(async ({ playwright, baseURL }) => {
  KEY = `rollen${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  PAGE = `/admin/projects/${KEY}/roles`;
  deployer = uniqueEmail('rollen-deploy');
  expect(admin(['create-project', KEY, 'Rollen Stadt']).status).toBe(0);
  createAdmin(deployer);
  expect(admin(['add-membership', deployer, KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: deployer, password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = uniqueEmail(`rollen${(admins += 1)}`);
  createAdmin(email);
  expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const addRow = (page: Page) => page.locator('[data-add-row]');
const rowOf = (page: Page, name: string) => page.getByRole('row', { name: new RegExp(name) });

async function rowAction(page: Page, name: string, item: string): Promise<void> {
  await rowOf(page, name).getByRole('button', { name: 'Menü öffnen' }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** Closes the open picker the way a user does: "Fertig" on a phone, the trigger again on desktop. */
async function closePicker(page: Page): Promise<void> {
  const phone = page.getByRole('dialog', { name: 'Optionen auswählen' });
  if (await phone.isVisible()) await phone.getByRole('button', { name: /^Fertig/ }).click();
  else await page.getByRole('dialog').locator('button[aria-haspopup]').click();
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: create a role, rename it, give it a person typed by name, delete it', async ({ page }) => {
      await signIn(page);
      await page.goto(PAGE);
      await expect(page.getByRole('heading', { name: 'Rollen' })).toBeVisible();
      await expect(page.getByText('Rollen und Berechtigungen für Teilnehmende verwalten')).toBeVisible();
      for (const column of ['Rollenname', 'Beschreibung', 'Zugewiesene Teilnehmende'])
        await expect(page.getByRole('columnheader', { name: new RegExp(column) })).toBeVisible();
      await expect(rowOf(page, 'Handwerker')).toBeVisible();

      // Rolle erstellen (inline): name, description, check.
      const role = `Gutachter ${size.name}`;
      await addRow(page).getByRole('button', { name: '-' }).first().click();
      await addRow(page).getByRole('textbox').fill(role);
      await page.keyboard.press('Enter');
      await addRow(page).getByRole('button', { name: '-' }).first().click();
      await addRow(page).getByRole('textbox').fill('Prüft Meldungen');
      await page.keyboard.press('Enter');
      await addRow(page).getByRole('button', { name: 'Zeile hinzufügen' }).click();
      await expect(page.getByText('Rolle erfolgreich erstellt')).toBeVisible();
      await expect(rowOf(page, role)).toContainText('Prüft Meldungen');
      await expect(page.getByTestId('publish-bar')).toBeVisible(); // the role is in the draft (Q13)

      // Rolle bearbeiten: the dialog keeps the key and changes the name.
      const renamed = `Gutachterin ${size.name}`;
      await rowAction(page, role, 'Bearbeiten');
      const edit = page.getByRole('dialog', { name: 'Rolle bearbeiten' });
      await expect(edit.getByLabel('Rollenname')).toHaveValue(role);
      await edit.getByLabel('Rollenname').fill(renamed);
      await edit.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Rolle erfolgreich aktualisiert')).toBeVisible();
      await expect(rowOf(page, renamed)).toBeVisible();

      // Teilnehmende bearbeiten: a name typed into the picker creates the person, Speichern gives them the role.
      const person = `Dora ${size.name}`;
      await rowAction(page, renamed, 'Teilnehmende bearbeiten');
      const members = page.getByRole('dialog', { name: 'Teilnehmende bearbeiten' });
      await members.locator('button[aria-haspopup]').click();
      await page.getByRole('textbox', { name: /suchen/i }).fill(person);
      await page.keyboard.press('Enter');
      await closePicker(page);
      await members.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Teilnehmende erfolgreich aktualisiert')).toBeVisible();
      await expect(rowOf(page, renamed)).toContainText('1');

      // Rolle löschen: asks first; the dialog names the person who has the role.
      await rowAction(page, renamed, 'Löschen');
      const confirm = page.getByRole('alertdialog');
      await expect(confirm.getByText('Sind Sie sicher, dass Sie diese Rolle löschen möchten?')).toBeVisible();
      await expect(confirm.getByTestId('delete-people')).toContainText(person);
      await confirm.getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByText('Rolle erfolgreich gelöscht')).toBeVisible();
      await expect(rowOf(page, renamed)).toHaveCount(0);
    });
  });
}
