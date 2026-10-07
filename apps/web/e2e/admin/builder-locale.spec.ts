import { expect, test, type Page } from '@playwright/test';
import { goldenFile, goldenData } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-403: the Objektart builder page inside the admin shell follows the admin language (the `ub_locale` cookie, one
 * resolver). German by default; English with the cookie.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const KEY = 'buildlocale';
const SIZES = [
  { name: 'phone', width: 390, height: 844, email: 'bl-phone@example.org' },
  { name: 'desktop', width: 1280, height: 800, email: 'bl-desktop@example.org' },
] as const;

test.use({ locale: 'de-DE' });

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Build Locale']).status).toBe(0);
  for (const email of ['bl-deploy@example.org', ...SIZES.map((s) => s.email)]) {
    createAdmin(email);
    expect(admin(['add-membership', email, KEY, 'verwaltung']).status).toBe(0);
  }
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'bl-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/musterstadt-baeume.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function setLanguage(page: Page, language: 'de' | 'en'): Promise<void> {
  await page
    .context()
    .addCookies([{ name: 'ub_locale', value: language, domain: new URL(page.url()).hostname, path: '/' }]);
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the Objektart builder page follows the language', async ({ page }) => {
      await signInAs(page, size.email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      const url = `/admin/projects/${KEY}/types/baum/builder`;
      await page.goto(url);
      const frame = page.getByTestId('builder-frame');
      await expect(frame.getByRole('button', { name: 'Speichern', exact: true })).toBeVisible();
      await setLanguage(page, 'en');
      await page.goto(url);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(frame.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
      await expect(frame.getByRole('button', { name: 'Speichern', exact: true })).toHaveCount(0);
      await setLanguage(page, 'de');
    });
  });
}
