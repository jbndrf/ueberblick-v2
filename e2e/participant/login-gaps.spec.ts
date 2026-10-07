import { expect, test } from '@playwright/test';

/** WP-651: the sign-in page at phone and desktop size (lead-c's viewport projects do not exist yet). */
for (const [name, size] of [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 800 }],
] as const) {
  test.describe(name, () => {
    test.use({ viewport: size });

    test('the body does not scroll on /login', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Participant sign-in' })).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(
        true,
      );
    });

    test('an empty submit shows the field error under the input, not the native bubble', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByText('Token is required')).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
    });

    test('the language menu offers English and Deutsch', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Language' }).click();
      await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeVisible();
      await expect(page.getByRole('menuitemradio', { name: 'Deutsch' })).toBeVisible();
    });
  });
}
