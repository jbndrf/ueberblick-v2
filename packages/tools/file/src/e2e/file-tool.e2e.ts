import { expect, test } from '@playwright/test';
import { axeViolations } from '../../../../../e2e/a11y/axe';

/** v3's "Dateien" button at phone 390x844 and desktop 1280x800 (the projects of the shared component config). */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows the Files button, 48 px high and fully inside the viewport', async ({ page }) => {
  const button = page.locator('label.ub-file-btn');
  await expect(button).toHaveText('Files');
  const box = await button.boundingBox();
  const size = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  expect((box?.x ?? -1) + (box?.width ?? 0)).toBeLessThanOrEqual(size?.width ?? 0);
});

test('picking a file adds a row and keeps the earlier ones', async ({ page }) => {
  const input = page.locator('input[type=file]');
  await input.setInputFiles({
    name: 'plan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  await expect(page.getByRole('list', { name: 'Attachments' }).getByRole('listitem')).toHaveText([
    'plan.pdf',
  ]);
  await input.setInputFiles({
    name: 'two.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.5'),
  });
  await expect(page.getByRole('listitem')).toHaveText(['plan.pdf', 'two.pdf']);
  await expect(page.getByTestId('value')).toContainText('"mime":"application/pdf"');
});

test('a refused type shows the message and adds no row', async ({ page }) => {
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'a.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
  await expect(page.getByRole('status')).toHaveText('This file type is not allowed here.');
  await expect(page.getByRole('listitem')).toHaveCount(0);
});

test('axe finds nothing', async ({ page }) => {
  const violations = await axeViolations(page, { scope: '#app' });
  expect(violations).toEqual([]);
});
