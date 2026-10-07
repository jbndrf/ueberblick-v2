import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openControlDb, setSelfJoin } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData, goldenFile } from '../golden';

/**
 * WP-324: the Teilnehmende page (v3 `participants/+page.svelte`) against the real built process, at phone (390x844) and
 * desktop (1280x800) size: open the project, add a person with a role, copy the login link, export the QR badges,
 * switch the person off and on, and add a custom column.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const KEY = 'teamstadt';
const SLUG = 'team-gaeste';
const PAGE = `/admin/projects/${KEY}/participants`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Team Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'team-deploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'team-deploy@example.org', KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'team-deploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
  // a self-join link for the role "melder", so that guests can join (the "Gäste anzeigen" switch lists them)
  const control = openControlDb(`${E2E_DATA_DIR}/control.db`);
  const row = control.prepare<{ id: string }>('SELECT id FROM projects WHERE key = ?').get(KEY);
  expect(
    setSelfJoin({ control, now: () => new Date() }, row?.id ?? '', 'melder', { enabled: true, slug: SLUG })
      .ok,
  ).toBe(true);
  control.close();
});

async function signIn(page: Page): Promise<void> {
  const email = `team${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const addRow = (page: Page) => page.locator('[data-add-row]');

/** Picks an option of the open Rollen picker: v3's MultiSelect is a dropdown on desktop and a full-screen dialog on a phone (its rows are checkboxes). */
async function pickRole(page: Page, label: string): Promise<void> {
  const phone = page.getByRole('dialog', { name: 'Optionen auswählen' });
  await page
    .getByRole('option', { name: label })
    .or(phone.getByRole('checkbox', { name: label }))
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

async function addPerson(page: Page, name: string, role?: string): Promise<void> {
  await addRow(page).getByRole('button', { name: '-' }).first().click();
  await addRow(page).getByRole('textbox').fill(name);
  await page.keyboard.press('Enter');
  if (role !== undefined) {
    await addRow(page).getByRole('button', { name: 'Rollen auswählen oder suchen...' }).click();
    await page.getByRole('button', { name: /^Auswählen oder suchen/ }).click();
    await pickRole(page, role);
    await addRow(page).getByRole('button', { name: 'Speichern' }).click();
  }
  await addRow(page).getByRole('button', { name: 'Zeile hinzufügen' }).click();
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: add Anna with a role, copy the link, export the QR, disable, enable', async ({
      page,
      context,
      request,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await signIn(page);
      await page.goto(PAGE);
      await expect(page.getByRole('heading', { name: 'Teilnehmende' })).toBeVisible();
      for (const column of ['Name', 'E-Mail', 'Telefon', 'Zugangstoken', 'Rollen', 'Status'])
        await expect(page.getByRole('columnheader', { name: new RegExp(column) })).toBeVisible();

      const name = `Anna ${size.name}`;
      await addPerson(page, name, 'Melder');
      await expect(page.getByText('Teilnehmende erfolgreich erstellt')).toBeVisible();
      const row = page.getByRole('row', { name: new RegExp(name) });
      await expect(row).toContainText('Melder');

      // Copy: the login link is on the clipboard, and it signs the person in.
      await row.getByRole('button', { name: 'Kopieren' }).click();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      expect(link).toMatch(/\/login\?token=[A-Z0-9-]+$/);
      const token = new URL(link).searchParams.get('token') ?? '';
      await expect(row).toContainText(token);
      // a separate request context: a sign-in on the page's context would replace the admin session
      const exchange = await request.post('/api/auth/exchange', { data: { token } });
      expect(exchange.status()).toBe(200);

      // QR exportieren (1): a PDF, one badge on one page.
      await row.getByRole('checkbox', { name: 'Zeile auswählen' }).check();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'QR exportieren (1)' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe('participants-qr-codes.pdf');
      const pdf = (await readFile(await file.path())).toString('latin1');
      expect(pdf.startsWith('%PDF')).toBe(true);
      expect(pdf.match(/\/Type\s*\/Page(?![s\w])/g)).toHaveLength(1);
      expect(pdf).toContain(`(${name}) Tj`);
      await expect(page.getByText('QR-Code PDF erfolgreich exportiert')).toBeVisible();

      // Status: off, then on, and it stays after a reload.
      const status = row.getByRole('switch', { name: 'Status' });
      await expect(status).toBeChecked();
      await status.click();
      await expect(status).not.toBeChecked();
      await page.reload();
      await expect(
        page.getByRole('row', { name: new RegExp(name) }).getByRole('switch', { name: 'Status' }),
      ).not.toBeChecked();
      await page
        .getByRole('row', { name: new RegExp(name) })
        .getByRole('switch', { name: 'Status' })
        .click();
      await expect(
        page.getByRole('row', { name: new RegExp(name) }).getByRole('switch', { name: 'Status' }),
      ).toBeChecked();
    });

    test('journey: "Gäste anzeigen" lists the self-joined guests, off hides them again', async ({
      page,
      browser,
      baseURL,
    }) => {
      // a guest joins by the link (own browser context: the admin session on `page` stays)
      const visitor = await browser.newContext({ baseURL: baseURL ?? '' });
      const joined = await visitor.newPage();
      await joined.goto(`/join/${SLUG}`);
      await joined.waitForURL(/\/map$/, { waitUntil: 'commit' });
      await visitor.close();

      await signIn(page);
      await page.goto(PAGE);
      const guests = page.getByRole('switch', { name: 'Gäste anzeigen' });
      await expect(guests).not.toBeChecked();
      const hidden = await page.getByRole('row').count();
      await guests.click();
      await expect(page).toHaveURL(/showGuests=true/);
      await expect(page.getByRole('switch', { name: 'Gäste anzeigen' })).toBeChecked();
      expect(await page.getByRole('row').count()).toBeGreaterThan(hidden);
      await page.getByRole('switch', { name: 'Gäste anzeigen' }).click();
      await expect(page.getByRole('switch', { name: 'Gäste anzeigen' })).not.toBeChecked();
      await expect(page.getByRole('row')).toHaveCount(hidden);
    });

    test('journey: a role typed in the Rollen cell goes into the draft', async ({ page }) => {
      await signIn(page);
      await page.goto(PAGE);
      const name = `Chris ${size.name}`;
      const role = `Praktikum ${size.name}`;
      await addRow(page).getByRole('button', { name: '-' }).first().click();
      await addRow(page).getByRole('textbox').fill(name);
      await page.keyboard.press('Enter');
      await addRow(page).getByRole('button', { name: 'Rollen auswählen oder suchen...' }).click();
      await page.getByRole('button', { name: /^Auswählen oder suchen/ }).click();
      await typeRole(page, role);
      await addRow(page).getByRole('button', { name: 'Speichern' }).click();
      await addRow(page).getByRole('button', { name: 'Zeile hinzufügen' }).click();
      await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText(role);
      const draft = (await (await page.request.get(`/builder-api/${KEY}/draft`)).json()) as {
        overlay: string;
      };
      expect(draft.overlay).toContain(`roles.praktikum_${size.name}`);
    });

    test('journey: a custom column "Personalnummer" (Text, Pflichtfeld) and an add without it', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(PAGE);
      await page.getByRole('button', { name: 'Feld hinzufügen' }).click();
      const manager = page.getByRole('dialog', { name: /Benutzerdefinierte Felder/ });
      await manager.getByRole('button', { name: 'Feld hinzufügen' }).click();
      const form = page.getByRole('dialog', { name: 'Feld hinzufügen' });
      await form.getByLabel('Feldname').fill(`Personalnummer ${size.name}`);
      await form.getByText('Pflichtfeld').click();
      await form.getByRole('button', { name: 'Erstellen' }).click();
      await expect(manager.getByText(`Personalnummer ${size.name}`)).toBeVisible();
      await manager.getByRole('button', { name: 'Schließen', exact: true }).first().click();
      await expect(
        page.getByRole('columnheader', { name: new RegExp(`Personalnummer ${size.name}`) }),
      ).toBeVisible();

      // An add without the required value is refused: the row stays in the add row, no new person.
      const name = `Dora ${size.name}`;
      await addRow(page).getByRole('button', { name: '-' }).first().click();
      await addRow(page).getByRole('textbox').fill(name);
      await page.keyboard.press('Enter');
      await addRow(page).getByRole('button', { name: 'Zeile hinzufügen' }).click();
      await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(1); // the add row itself
      await expect(addRow(page)).toContainText(name);

      // The column is project data and the next journey adds people without it: take it away again, as the admin would.
      await page.evaluate(async (project) => {
        await fetch(`/api/admin/p/${project}/participants/columns`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ columns: [] }),
        });
      }, KEY);
    });
  });
}
