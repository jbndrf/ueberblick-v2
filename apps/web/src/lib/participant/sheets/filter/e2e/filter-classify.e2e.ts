// WP-674 (B-018): the Einfach rows draw the icon or the colour the map draws each value in (v3 `FilterSheet.svelte:410-455`),
// at phone 390x844 and desktop 1280x800.
import { expect, test } from '@playwright/test';
import { axeViolations } from '../../../../../../../../e2e/a11y/axe';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Karteninhalt')).toBeVisible();
});

test('the card draws the type icon, a value its icon or a dot in its colour', async ({ page }) => {
  const card = page.locator('[data-card="baum"]');
  await expect(card.locator('[data-icon="type"]')).toBeVisible();
  await expect(card.locator('[data-dot="type"]')).toHaveCount(0);
  // a plain card keeps its dot
  await expect(page.locator('[data-card="bank"] [data-dot="type"]')).toBeVisible();
  await page.getByRole('button', { name: 'Baum aufklappen' }).click();
  await expect(page.locator('[data-row="erledigt"] [data-icon="value"]')).toBeVisible();
  await expect(page.locator('[data-row="erfasst"] [data-icon="value"]')).toHaveCount(0);
  await expect(page.locator('[data-row="erfasst"] [data-dot="value"]')).toHaveCSS(
    'background-color',
    'rgb(22, 163, 74)',
  );
});

test('the icon is an image the sheet does not run: it loads, at the size of the v3 row icon', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Baum aufklappen' }).click();
  const icon = page.locator('[data-row="erledigt"] [data-icon="value"]');
  await expect
    .poll(() => icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  expect(await icon.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  const box = await icon.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(16); // v3's h-5 w-5 cell inside a row at zoom 0.8
});

test('has no axe violations with the icons drawn', async ({ page }) => {
  await page.getByRole('button', { name: 'Baum aufklappen' }).click();
  const violations = await axeViolations(page, { scope: 'body' });
  expect(violations).toEqual([]);
});
