import { expect, test } from '@playwright/test';
import { axeViolations } from '../../../../../../../e2e/a11y/axe';

/** v3's Infoseiten list and dialog at phone 390x844 and desktop 1280x800. */

test('the participant card shows name and e-mail; info pages come before the legal heading', async ({
  page,
}) => {
  await page.goto('/');
  const card = page.getByTestId('participant-card');
  await expect(card).toContainText('Anna Beispiel');
  await expect(card).toContainText('anna@example.org');
  const rows = page.getByRole('button', { name: /^(Hilfe|Zweites Handy|Impressum)$/ });
  await expect(rows).toHaveText(['Hilfe', 'Zweites Handy', 'Impressum']);
  await expect(page.getByText('Rechtliches')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the dialog shows the token and draws both QR codes inside the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Zweites Handy' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zweites Handy' });
  await expect(dialog).toContainText('Link: https://example.org/login/tok-4711');
  const codes = dialog.getByTestId('info-qr');
  await expect(codes).toHaveCount(2);
  await expect(codes.nth(0).locator('svg')).toBeVisible();
  await expect(codes.nth(0)).toHaveAttribute('data-value', 'https://example.org/login/tok-4711');
  await expect(codes.nth(1)).toHaveAttribute('data-value', 'tok-4711');
  const box = await dialog.boundingBox();
  const vp = page.viewportSize();
  expect(box !== null && vp !== null && box.x >= 0 && box.x + box.width <= vp.width).toBe(true);
  expect(box !== null && vp !== null && box.height <= vp.height * 0.8 + 1).toBe(true);
});

test('a page with $token shows the token; the legal page opens too', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Hilfe' }).click();
  await expect(page.getByRole('dialog', { name: 'Hilfe' })).toContainText('Dein Token: tok-4711');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Impressum' }).click();
  await expect(page.getByRole('dialog', { name: 'Impressum' })).toContainText('Betreiber Beispiel');
});

test('axe finds nothing on the list or in the dialog', async ({ page }) => {
  await page.goto('/');
  const run = () => axeViolations(page);
  expect(await run()).toEqual([]);
  await page.getByRole('button', { name: 'Zweites Handy' }).click();
  await expect(page.getByTestId('info-qr').first().locator('svg')).toBeVisible();
  // The dialog fades in over 200 ms; axe would read the half-transparent text mid-animation. Wait for the stable state.
  await page.evaluate(async () => {
    const dialog = document.querySelector('[role="dialog"]');
    await Promise.all((dialog?.getAnimations({ subtree: true }) ?? []).map((a) => a.finished));
  });
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  expect(await run()).toEqual([]);
});
