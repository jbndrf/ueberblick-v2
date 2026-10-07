import { expect, test } from '@playwright/test';
import { axeViolations } from '../../../../../../../../e2e/a11y/axe';

/** v3's Aktivität timeline at phone 390x844 and desktop 1280x800: same layout, no horizontal scroll. */

test('stage visit header, Erstellt header and run lines, newest first', async ({ page }) => {
  await page.goto('/');
  const stage = page.getByTestId('activity-stage');
  await expect(stage).toContainText('Verschoben nach: Maßnahme');
  await expect(stage).toContainText('vor 5 Std · Jemand');
  const rows = page.getByTestId('activity-entry');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Befund aktualisiert');
  await expect(rows.nth(0)).toContainText('Kontrolle · Anna Beispiel');
  await expect(rows.nth(0).getByTestId('activity-run-status')).toHaveText('Wartet auf Übertragung');
  // the stage header is above the runs after the move; the Erstellt header and the earlier run sit in the first stage
  await expect(rows.nth(1)).toContainText('Erstellt');
  await expect(rows.nth(1)).toContainText('Erfasst');
  await expect(rows.nth(2)).toContainText('2 Felder aktualisiert');
  await expect(rows.nth(2)).toContainText('Bert Muster');
  const box = await stage.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box !== null && box.x + box.width <= width).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a row expands to the changed values', async ({ page }) => {
  await page.goto('/');
  const row = page.getByTestId('activity-entry').nth(2);
  await row.locator('summary').click();
  await expect(row.getByTestId('activity-detail')).toContainText('Höhe:');
  await expect(row.getByTestId('activity-detail')).toContainText('12');
});

test('empty state', async ({ page }) => {
  await page.goto('/?empty=1');
  await expect(page.getByText('Noch keine Aktivität')).toBeVisible();
});

test('no axe violations', async ({ page }) => {
  await page.goto('/');
  const violations = await axeViolations(page);
  expect(violations).toEqual([]);
});
