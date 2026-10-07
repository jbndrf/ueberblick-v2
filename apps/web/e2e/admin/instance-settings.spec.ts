import { expect, test, type Page } from '@playwright/test';
import { createInstanceStore, openControlDb } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { createAdmin, signInAs } from './sign-in';

/**
 * WP-447: v3's "Instanz-Einstellungen" page (`admin/instance/+page.svelte`) against the real built process, at phone
 * (390x844) and desktop (1280x800) size: reached from the sidebar's global menu, consent turned on and the banner
 * text edited, a legal page added, edited (a new slug renames it) and deleted, and the page seen on `/legal`.
 * The run puts the instance back (consent off, no pages): the participant specs share the data directory.
 */
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });

const clock = { now: (): string => new Date().toISOString() };
function resetInstance(): void {
  const control = openControlDb(`${E2E_DATA_DIR}/control.db`);
  try {
    const store = createInstanceStore(control, clock as never);
    store.saveSettings({
      requireConsent: false,
      consentTitle: '',
      consentBody: '',
      acceptLabel: '',
      rejectLabel: '',
    });
    for (const p of store.pages()) store.removePage(p.slug);
  } finally {
    control.close();
  }
}

test.beforeEach(resetInstance);
test.afterEach(resetInstance);

let admins = 0;
async function signIn(page: Page): Promise<void> {
  const email = `instanz${(admins += 1)}-${process.pid}@example.org`;
  createAdmin(email);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

/** A toast covers the buttons under it on a phone; the next step waits until it is gone. */
const noToast = (page: Page) =>
  expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 });
const card = (page: Page, testId: string) => page.getByTestId(testId);

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: sidebar entry, consent on and banner text, add / edit / delete a legal page, see it on /legal', async ({
      page,
    }) => {
      await signIn(page);

      // The global menu entry at the end of the sidebar (v3 :568-586), a sheet on a phone.
      await page.goto('/admin/projects');
      const entry = page.getByRole('link', { name: 'Instanz-Einstellungen' });
      if (!(await entry.isVisible()))
        await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
      await entry.click();
      await expect(page).toHaveURL(/\/admin\/instance$/);
      // v3's sidebar sheet stays open after a link on a phone; the admin closes it.
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { name: 'Instanz-Einstellungen' })).toBeVisible();
      await expect(
        page.getByText('Diese Seiten gelten instanzweit und sind öffentlich sichtbar.'),
      ).toBeVisible();

      // Consent: on, banner heading and text, button labels; saved with the toast and kept after a reload.
      const consent = card(page, 'consent-card');
      await consent.getByRole('checkbox', { name: 'Cookie-Zustimmung vor Login erforderlich' }).click();
      await consent.getByLabel('Banner-Überschrift').fill(`Datenschutz ${size.name}`);
      await consent.getByLabel('Banner-Text (HTML erlaubt)').fill('<p>Wir setzen Cookies ein.</p>');
      await consent.getByLabel('Beschriftung Annehmen-Button').fill('Einverstanden');
      await consent.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Gespeichert.')).toBeVisible();
      await page.reload();
      const reloaded = card(page, 'consent-card');
      await expect(
        reloaded.getByRole('checkbox', { name: 'Cookie-Zustimmung vor Login erforderlich' }),
      ).toBeChecked();
      await expect(reloaded.getByLabel('Banner-Überschrift')).toHaveValue(`Datenschutz ${size.name}`);
      await expect(reloaded.getByLabel('Beschriftung Annehmen-Button')).toHaveValue('Einverstanden');

      // Add a legal page: the slug follows the title.
      await noToast(page);
      const add = card(page, 'new-page-card');
      await add.getByLabel('Titel').fill(`Impressum ${size.name}`);
      await add.getByLabel('Inhalt (HTML erlaubt)').fill('<h1>Impressum</h1><p>Betreiber der Instanz</p>');
      await add.getByRole('button', { name: 'Seite anlegen' }).click();
      await expect(page.getByText('Angelegt.')).toBeVisible();
      const slug = `impressum-${size.name}`;
      const legal = page.locator(`[data-testid="legal-page"][data-slug="${slug}"]`);
      await expect(legal.getByRole('link', { name: `/legal/${slug}` })).toBeVisible();
      await expect(add.getByLabel('Titel')).toHaveValue('');

      // A taken slug is refused with a message.
      await noToast(page);
      await add.getByLabel('Titel').fill(`Impressum ${size.name}`);
      await add.getByRole('button', { name: 'Seite anlegen' }).click();
      await expect(page.getByText('Dieser Slug ist schon vergeben.')).toBeVisible();
      await add.getByLabel('Titel').fill('');

      // The participants' /legal list and page show it.
      await page.goto('/legal');
      await page.getByRole('link', { name: `Impressum ${size.name}` }).click();
      await expect(page.getByText('Betreiber der Instanz')).toBeVisible();

      // Edit: a new slug renames the page.
      await page.goto('/admin/instance');
      const renamed = `datenschutz-${size.name}`;
      const edit = page.locator(`[data-testid="legal-page"][data-slug="${slug}"]`);
      await edit.getByLabel('Slug (URL)').fill(renamed);
      await edit.getByLabel('Reihenfolge').fill('3');
      await edit.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Gespeichert.')).toBeVisible();
      const moved = page.locator(`[data-testid="legal-page"][data-slug="${renamed}"]`);
      await expect(moved).toBeVisible();
      await expect(page.locator(`[data-slug="${slug}"]`)).toHaveCount(0);

      // WP-464: the renamed page renders at /legal/<slug>, the old address is gone.
      await page.goto(`/legal/${renamed}`);
      await expect(page.getByText('Betreiber der Instanz')).toBeVisible();
      const gone = await page.request.get(`/legal/${slug}`);
      expect(gone.status()).toBe(404);
      await page.goto('/admin/instance');
      const moved2 = page.locator(`[data-testid="legal-page"][data-slug="${renamed}"]`);
      await expect(moved2).toBeVisible();

      // Delete: asks first.
      await noToast(page);
      await moved.getByRole('button', { name: 'Löschen' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByText('Diese Seite löschen?')).toBeVisible();
      await dialog.getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByText('Gelöscht.')).toBeVisible();
      await expect(page.locator('[data-testid="legal-page"]')).toHaveCount(0);
    });
  });
}
