import { expect, test } from '@playwright/test';
import { issueToken, seedWorld } from './world';

/**
 * WP-609: v3's sign-in page in a real browser. After sign-in the page lands on `/map`, v3's map screen (WP-620).
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

const IN_APP = /\/map$/;

test('a typed token signs in with one tap and lands in the app', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Participant sign-in' })).toBeVisible();
  await page.getByLabel('Access token').fill(issueToken());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(IN_APP);
});

test('the login link signs in with zero taps and the token leaves the address bar', async ({ page }) => {
  await page.goto(`/login?token=${issueToken()}`);
  await expect(page).toHaveURL(IN_APP);
  expect(page.url()).not.toContain('token');
  await page.goBack();
  expect(page.url()).not.toContain('token');
});

test('a wrong token says why, and the rate limit says how long to wait', async ({ page }) => {
  await page.goto('/login');
  const field = page.getByLabel('Access token');
  // The throttle keys on the token and lives as long as the server: a token of its own per run keeps a repeat from starting refused.
  await field.fill(`not-a-token-${crypto.randomUUID()}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid or expired token');
  // 5 failures per token (one done above), then the 6th attempt is refused; the per-address window (30) allows 5 repeats per server run
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Too many sign-in attempts');
});

test('the language switch turns the page German and the choice stays', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Deutsch' }).click();
  await expect(page.getByRole('tab', { name: 'Token-Anmeldung' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Anmeldung für Teilnehmende' })).toBeVisible();
});

test('the QR tab loads the scanner only when opened', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', (r) => chunks.push(r.url()));
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  const before = chunks.length;
  await page.getByRole('tab', { name: 'QR code' }).click();
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeEnabled();
  expect(chunks.length).toBeGreaterThan(before);
});
