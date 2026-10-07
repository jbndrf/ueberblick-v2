import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-391: Projekteinstellungen, section Chat (v3 `ChatSection`) against the real built process, at phone (390x844) and
 * desktop (1280x800) size: the switch "Projekt-Chat aktivieren", the role select "Im Chat zugelassene Rollen" (empty =
 * alle), Speichern into the draft, published from the bar, and read back after a reload.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const KEY = 'chatstadt';
const PAGE = `/admin/projects/${KEY}/settings?section=chat`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Chat Stadt']).status).toBe(0);
  createAdmin('chat-deploy@example.org');
  expect(admin(['add-membership', 'chat-deploy@example.org', KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'chat-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `chat${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

/** Veröffentlichen from the bar; if the bar stays, the status route says why (problems, conflict). */
async function publishFromBar(page: Page): Promise<void> {
  await page.getByTestId('publish-bar').getByRole('button', { name: 'Veröffentlichen' }).click();
  // WP-360: the bar opens the deploy overview, whose own button deploys.
  const dialog = page.getByTestId('deploy-overview');
  await expect(dialog).toBeVisible();
  const deployed = page.waitForResponse((r) => r.url().includes('/deploy'));
  await dialog.getByRole('button', { name: 'Veröffentlichen' }).click();
  const answer = await (await deployed).text();
  try {
    await expect(page.getByTestId('publish-bar')).toBeHidden();
  } catch (e) {
    const status = await page.request.get(`/api/admin/p/${KEY}/draft/status`);
    throw new Error(`publish refused: ${answer} | ${await status.text()}`, { cause: e });
  }
}

/** Toggles one row of the open role picker: a dropdown on desktop, a full-screen dialog on a phone (rows are checkboxes). The kit picks its own language (the admin does not set it yet), so both are accepted. */
async function toggleRole(page: Page, label: string): Promise<void> {
  const phone = page.getByRole('dialog', { name: /Optionen auswählen|Select options/ });
  await page
    .getByRole('option', { name: label })
    .or(phone.getByRole('checkbox', { name: label }))
    .click();
  if (await phone.isVisible()) await phone.getByRole('button', { name: /^(Fertig|Done)/ }).click();
  else await page.keyboard.press('Escape');
}

const save = (page: Page) => page.getByRole('button', { name: 'Speichern' });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: chat on, restricted to a role, published, back to alle, off', async ({ page }) => {
      await signIn(page);
      await page.goto(PAGE);

      // The section: group Funktionen, v3's title, the switch and its hint; the role select only while on.
      const nav = page.getByRole('navigation', { name: 'Einstellungsbereiche' });
      await expect(nav).toContainText('Funktionen');
      await expect(nav.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { level: 2, name: 'Projekt-Chat' })).toBeVisible();
      const chatSwitch = page.getByRole('switch', { name: 'Projekt-Chat aktivieren' });
      await expect(chatSwitch).toBeVisible();
      // Both runs start with no chat (the phone run ends with it switched off and published).
      await expect(page.getByText('Im Chat zugelassene Rollen')).toHaveCount(0);
      const sidebarBox = await nav.boundingBox();
      const sectionBox = await page.getByTestId('settings-section').boundingBox();
      if (size.name === 'phone') expect(sectionBox?.y ?? 0).toBeGreaterThan(sidebarBox?.y ?? 0);
      else expect(sectionBox?.x ?? 0).toBeGreaterThan(sidebarBox?.x ?? 0);

      // On, restricted to one role.
      await chatSwitch.click();
      await expect(page.getByText('Im Chat zugelassene Rollen')).toBeVisible();
      await expect(page.getByText('Leere Liste = offen für alle Teilnehmer:innen')).toBeVisible();
      await page.getByText('Leer = alle im Projekt').click();
      await toggleRole(page, 'Melder');
      await save(page).click();
      await expect(page.getByText('Chat-Einstellungen gespeichert')).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeVisible();
      await expect(nav.locator('[data-section="chat"] [data-status="on"]')).toBeVisible();
      await publishFromBar(page);

      // After a reload the draft shows the switch on and exactly that role.
      await page.reload();
      await expect(chatSwitch).toBeChecked();
      await expect(page.getByTestId('settings-section').getByText('Melder', { exact: true })).toBeVisible();
      await expect(page.getByText('Leer = alle im Projekt')).toHaveCount(0);

      // Clearing the selection restores alle.
      await page.getByTestId('settings-section').getByText('Melder', { exact: true }).click();
      await toggleRole(page, 'Melder');
      await save(page).click();
      await expect(page.getByText('Chat-Einstellungen gespeichert')).toBeVisible();
      await page.reload();
      await expect(chatSwitch).toBeChecked();
      await expect(page.getByText('Leer = alle im Projekt')).toBeVisible();

      // Off: the select goes, the status dot is off, and the removal publishes like any change (A-041).
      await chatSwitch.click();
      await expect(page.getByText('Im Chat zugelassene Rollen')).toHaveCount(0);
      await save(page).click();
      await expect(page.getByText('Chat-Einstellungen gespeichert')).toBeVisible();
      await expect(nav.locator('[data-section="chat"] [data-status="off"]')).toBeVisible();
      await publishFromBar(page);
      await page.reload();
      await expect(chatSwitch).not.toBeChecked();
    });
  });
}
