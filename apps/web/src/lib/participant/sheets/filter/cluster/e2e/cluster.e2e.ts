import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../../../../../e2e/a11y/axe';

/** v3's Cluster tab at phone 390x844 and desktop 1280x800 (the projects come from `phoneAndDesktop()`). */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Karteninhalt' })).toBeVisible();
  await page.getByRole('tab', { name: 'Cluster' }).click();
});

const drawn = (page: Page) => page.getByTestId('drawn');
const sw = (page: Page) => page.getByRole('switch', { name: 'Gruppierung aufheben' });

test('the tab shows the switch and its description; no cap field while it is off; the map stays clustered', async ({
  page,
}) => {
  await expect(page.getByText('Einzelne Marker in der aktuellen Ansicht anzeigen')).toBeVisible();
  await expect(sw(page)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByLabel('Bis zu')).toHaveCount(0);
  await expect(drawn(page)).toContainText('0 singles, 1 groups');
});

test('on: "Bis zu" 500 by default; 30 in view are drawn singly and the line says so', async ({ page }) => {
  await sw(page).click();
  const cap = page.getByLabel('Bis zu');
  await expect(cap).toHaveValue('500');
  await expect(drawn(page)).toContainText('30 singles, 0 groups');
  await expect(page.getByText('30 einzeln angezeigt')).toBeVisible();
});

test('above the cap the groups stay and the line says too many', async ({ page }) => {
  await sw(page).click();
  await page.getByLabel('Bis zu').fill('29');
  await page.getByLabel('Bis zu').blur();
  await expect(drawn(page)).toContainText('0 singles, 1 groups');
  await expect(page.getByText('30 im Blickfeld — zu viele, noch gruppiert')).toBeVisible();
});

test('an invalid cap is ignored', async ({ page }) => {
  await sw(page).click();
  const cap = page.getByLabel('Bis zu');
  for (const bad of ['0', '-5']) {
    await cap.fill(bad);
    await cap.blur();
    await expect(cap).toHaveValue('500');
  }
  await expect(drawn(page)).toContainText('30 singles');
});

test('the switch and the cap stay after a reload, offline (personal preferences)', async ({ page }) => {
  await sw(page).click();
  await page.getByLabel('Bis zu').fill('29');
  await page.getByLabel('Bis zu').blur();
  await page.reload();
  await page.getByRole('tab', { name: 'Cluster' }).click();
  await expect(sw(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Bis zu')).toHaveValue('29');
  await expect(drawn(page)).toContainText('0 singles, 1 groups');
});

test('switching the tool off while the tab is open falls back to Einfach and clusters again', async ({
  page,
}) => {
  await sw(page).click();
  await expect(drawn(page)).toContainText('30 singles');
  await page.getByTestId('tool-off').click();
  await expect(page.getByRole('tab', { name: 'Cluster' })).toHaveCount(0);
  await expect(page.getByText('Kein Karteninhalt verfügbar')).toBeVisible(); // the Einfach tab
  await expect(drawn(page)).toContainText('0 singles, 1 groups');
});

test('no axe violations in the sheet', async ({ page }) => {
  await sw(page).click();
  const violations = await axeViolations(page, { scope: '[data-slot="sheet-content"]' });
  expect(violations).toEqual([]);
});
