import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-394: the admin's language (the `ub_locale` cookie) reaches the ui package's strings. The Rollen picker on the
 * Teilnehmende page is the kit's MultiSelect: its search field, empty state and "Fertig" button are kit strings. They
 * follow the admin language after the switcher without a reload, and after a reload (server render), at phone and
 * desktop size. (The ui and server specs in `packages/ui/src/i18n-locale*.spec.ts` cover the form renderer's "Choose".)
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const KEY = 'localestadt';
const PAGE = `/admin/projects/${KEY}/participants`;
const SIZES = [
  { name: 'phone', width: 390, height: 844, email: 'locale-phone@example.org' },
  { name: 'desktop', width: 1280, height: 800, email: 'locale-desktop@example.org' },
] as const;

test.use({ locale: 'de-DE' });

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Locale Stadt']).status).toBe(0);
  for (const email of ['locale-deploy@example.org', ...SIZES.map((s) => s.email)]) {
    createAdmin(email);
    expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  }
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'locale-deploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/** Opens the Rollen picker of the add row: a dropdown on desktop, a full-screen dialog on a phone. */
async function openPicker(page: Page, trigger: RegExp): Promise<void> {
  const add = page.locator('[data-add-row]');
  await add.getByRole('button', { name: '-' }).first().click();
  await add.getByRole('button', { name: trigger }).click();
  await page.getByRole('button', { name: /^(Auswählen oder suchen|Select or search)/ }).click();
}

async function chooseLanguage(page: Page, account: string, menu: string, language: string): Promise<void> {
  // at phone size the account menu sits in the sidebar sheet
  if (!(await page.getByRole('button', { name: account }).isVisible())) {
    await page.getByRole('button', { name: /Seitenleiste umschalten|Toggle sidebar/ }).click();
  }
  await page.getByRole('button', { name: account }).click();
  await page.getByRole('menuitem', { name: menu }).click();
  await page.getByRole('menuitem', { name: language }).click();
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('kit strings follow the admin language; switching changes them without a reload', async ({
      page,
    }) => {
      await signInAs(page, size.email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto(PAGE);
      await openPicker(page, /Rollen auswählen/);
      const german = page
        .getByRole('textbox', { name: /Suchen/ })
        .or(page.getByRole('dialog', { name: 'Optionen auswählen' }));
      await expect(german.first()).toBeVisible();
      await page.keyboard.press('Escape');

      // the switcher: same page, no reload (a marker on window survives)
      await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
      await chooseLanguage(page, 'Konto', 'Sprache', 'English');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await openPicker(page, /Select roles|Select or search/);
      const english = page
        .getByRole('textbox', { name: /Search/ })
        .or(page.getByRole('dialog', { name: 'Select options' }));
      await expect(english.first()).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);

      // back to German (the cookie is the one source: a reload keeps it)
      await page.keyboard.press('Escape');
      await chooseLanguage(page, 'Account', 'Language', 'Deutsch');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      await openPicker(page, /Rollen auswählen/);
      await expect(german.first()).toBeVisible();
    });

    test('a language switch asks before it drops unsaved builder edits', async ({ page }) => {
      await signInAs(page, size.email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto(`/admin/projects/${KEY}/types/meldung/builder`);
      const frame = page.getByTestId('builder-frame');
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.getByRole('button', { name: 'Phase', exact: true }).click();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await expect(frame.getByTestId('unsaved')).toBeVisible();

      // dismissing the confirm keeps the language and the edits
      const asked: string[] = [];
      page.once('dialog', (d) => void d.dismiss().then(() => asked.push(d.message())));
      await chooseLanguage(page, 'Konto', 'Sprache', 'English');
      await expect.poll(() => asked.length).toBe(1);
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      await expect(frame.getByTestId('unsaved')).toBeVisible();

      // accepting switches the language (the edits are given up, as the admin confirmed)
      page.once('dialog', (d) => void d.accept());
      await chooseLanguage(page, 'Konto', 'Sprache', 'English');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });
  });
}
