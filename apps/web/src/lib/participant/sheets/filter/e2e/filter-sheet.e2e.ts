import { expect, test, type Page } from '@playwright/test';

/** v3's Karteninhalt sheet at phone 390x844 and desktop 1280x800 (the projects come from `phoneAndDesktop()`). */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Karteninhalt')).toBeVisible();
});

const state = (page: Page) => page.getByTestId('state');

test('left sheet, w-80, the same at every width; no overlay darkens the map', async ({ page }) => {
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect.poll(async () => (await sheet.boundingBox())?.x).toBe(0);
  expect((await sheet.boundingBox())?.width).toBe(320);
  await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0);
});

test('the map beside the open sheet keeps taking taps (not modal, no pointer-events none)', async ({
  page,
}) => {
  await expect(page.getByText('Karteninhalt')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe('none');
  await page.getByRole('button', { name: 'Karte' }).click({ force: false });
  await expect(page.getByTestId('taps')).toHaveText('1');
});

test('cards: dot, name, count and master switch; the chevron opens compact stage rows with zero counts kept', async ({
  page,
}) => {
  await expect(page.locator('[data-card="bank"] [data-dot="type"]')).toBeVisible(); // Baum draws its icon (WP-674)
  await expect(page.getByRole('switch', { name: 'Baum' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bank aufklappen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Baum aufklappen' }).click();
  await expect(page.locator('[data-row]')).toHaveCount(3);
  await expect(page.locator('[data-row="kontrolliert"]')).toContainText('0');
});

test('master off: stage switches stay enabled and show off; one stage on shows the type with that stage only', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Baum aufklappen' }).click();
  await page.getByRole('switch', { name: 'Baum' }).click();
  const erfasst = page.getByRole('switch', { name: 'Erfasst' });
  await expect(erfasst).toBeEnabled();
  await expect(erfasst).toHaveAttribute('aria-checked', 'false');
  await erfasst.click();
  await expect(page.getByRole('switch', { name: 'Baum' })).toHaveAttribute('aria-checked', 'true');
  await expect(state(page)).toContainText('"hiddenValues":[["baum",["kontrolliert","erledigt"]]]');
  await expect(state(page)).toContainText('"hiddenTypes":[]');
});

test('Ansichten: a project preset replaces the switches, with the banner, until it is turned off', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Ansichten' }).click();
  await expect(page.getByText('Vom Projekt')).toBeVisible();
  await page.getByRole('radio', { name: /Meine Bäume/ }).click();
  await expect(state(page)).toContainText('"active":{"kind":"preset","key":"meine"}');
  await page.getByRole('tab', { name: 'Einfach' }).click();
  await expect(page.getByText('„Meine Bäume“ ist aktiv')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Baum' })).toBeDisabled();
  await page.getByRole('button', { name: 'Ansicht ausschalten' }).click();
  await expect(page.getByText('„Meine Bäume“ ist aktiv')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Baum' })).toBeEnabled();
});

test('Ansichten: saved views offer rename, delete and a new view', async ({ page }) => {
  await page.getByRole('tab', { name: 'Ansichten' }).click();
  await expect(page.getByText('Mein Filter')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Umbenennen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Löschen' })).toBeVisible();
  await page.getByRole('button', { name: 'Neue Ansicht' }).click();
  await expect(page.getByPlaceholder('Ansicht benennen…')).toBeVisible();
});

test('Tabs verwalten sits in the header', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Tabs verwalten' })).toBeVisible();
});
