import { expect, test } from '@playwright/test';

/** v3's Daten read view at both sizes: boxes inside the viewport, badges in option order, the history dialog. */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('values sit in bordered boxes that fit the viewport', async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  const box = page.locator('[data-field-id="name"] dd > div').first();
  await expect(box).toHaveText('Alte Eiche');
  const b = await box.boundingBox();
  expect(b).not.toBeNull();
  expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(width);
  expect(b?.height ?? 0).toBeGreaterThanOrEqual(40);
  expect(await box.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('1px');
  expect(
    await page.locator('[data-field-id="name"] dt').evaluate((e) => getComputedStyle(e).textTransform),
  ).toBe('uppercase');
});

test('long text keeps its lines, selections are badges in option order, empty values say so', async ({
  page,
}) => {
  const notiz = page.locator('[data-field-id="notiz"] dd > div').first();
  expect((await notiz.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(100);
  expect(await notiz.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('pre-wrap');
  await expect(page.locator('[data-field-id="arten"] [data-slot="badge"]')).toHaveText(['Eiche', 'Ahorn']);
  await expect(page.locator('[data-field-id="leer"]').getByText('Kein Wert')).toBeVisible();
  await expect(page.locator('[data-field-id="foto"]').getByText('Keine Datei')).toBeVisible();
  await expect(page.locator('[data-field-id="gepflanzt"]')).toContainText('05.03.2024');
});

test('the history count opens the dialog, which fits and lists Geleert', async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  await page.getByRole('button', { name: '3 Änderungen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Verlauf — Name' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Geleert')).toBeVisible();
  const b = await dialog.boundingBox();
  expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(width);
  if (width >= 1024) expect(b?.width ?? 0).toBeLessThanOrEqual(672);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

/** WP-659: the admin's layout. The tabbed page is `/?tabs=1`: Kontrolle (first, ordered), Daten, Pflanzung; Fotos is hidden by its condition. */
test.describe('sub-tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?tabs=1');
  });

  test('the list is ordered by tab_order, the default tab is named Daten, hidden and conditional tabs are gone', async ({
    page,
  }) => {
    const triggers = page.getByTestId('daten-subtabs').getByRole('tab');
    // v3: the default tab first, then the custom ones by tab order; Fotos (condition false) and `leer` (hidden) never show
    await expect(triggers).toHaveText(['Daten', 'Kontrolle', 'Pflanzung']);
    await expect(page.locator('[data-field-id="leer"]')).toHaveCount(0);
    await expect(page.locator('[data-field-id="foto"]')).toHaveCount(0);
  });

  test('the list stays inside the viewport and scrolls rather than wrapping', async ({ page }) => {
    const width = page.viewportSize()?.width ?? 0;
    const list = page.getByTestId('daten-subtabs');
    const b = await list.boundingBox();
    expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(width);
    expect(await list.evaluate((e) => getComputedStyle(e).overflowX)).toBe('auto');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('a sub-tab shows its rows in the configured order', async ({ page }) => {
    await page.getByRole('tab', { name: 'Kontrolle' }).click();
    await expect(page.getByTestId('daten-property')).toHaveText([/Arten/, /Notiz/]);
    await page.getByRole('tab', { name: 'Pflanzung' }).click();
    await expect(page.locator('[data-field-id="gepflanzt"]')).toContainText('05.03.2024');
    await expect(page.locator('[data-field-id="notiz"]')).toHaveCount(0);
  });

  test('left and right cells of one row sit side by side at half width, also on the phone (v3 getColumnClass)', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: 'Kontrolle' }).click();
    const left = page.locator('[data-field-id="arten"]');
    const right = page.locator('[data-field-id="notiz"]');
    const l = await left.boundingBox();
    const r = await right.boundingBox();
    expect(l).not.toBeNull();
    expect(r).not.toBeNull();
    // same line, left before right, each about half of the line (minus the 1rem gap), inside the viewport
    expect(Math.abs((l?.y ?? 0) - (r?.y ?? 99))).toBeLessThan(2);
    expect((l?.x ?? 0) + (l?.width ?? 0)).toBeLessThanOrEqual(r?.x ?? 0);
    expect(Math.abs((l?.width ?? 0) - (r?.width ?? 0))).toBeLessThan(2);
    const width = page.viewportSize()?.width ?? 0;
    expect((r?.x ?? 0) + (r?.width ?? 0)).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('a full-width cell takes its own line', async ({ page }) => {
    const name = await page.locator('[data-field-id="name"]').boundingBox();
    const container = await page.locator('[data-field-id="name"]').locator('..').boundingBox();
    expect(Math.abs((name?.width ?? 0) - (container?.width ?? 1))).toBeLessThan(2);
  });

  test('the history count follows the hint', async ({ page }) => {
    await expect(page.getByRole('button', { name: '3 Messungen' })).toBeVisible();
    await expect(page.getByRole('button', { name: '3 Änderungen' })).toHaveCount(0);
  });
});

test('a type without display settings has no sub-tab list', async ({ page }) => {
  await expect(page.getByTestId('daten-subtabs')).toHaveCount(0);
});
