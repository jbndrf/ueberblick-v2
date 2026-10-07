import { expect, test, type Locator } from '@playwright/test';

/** v3's choice field at both sizes: the full-screen dialog on the phone, the popover on the desktop. */
const phone = (name: string) => name === 'phone';
async function rect(l: Locator) {
  const b = await l.boundingBox();
  if (b === null) throw new Error('element has no box');
  return b;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('single choice: opens, filters, picks and closes', async ({ page }, info) => {
  const trigger = page.getByRole('button', { name: 'Art' });
  await expect(trigger).toContainText('Choose');
  await trigger.click();
  const box = phone(info.project.name) ? page.getByRole('dialog') : page.getByRole('listbox');
  await expect(box).toBeVisible();
  await page.getByRole('textbox').fill('bu');
  await box.getByText('Buche').click();
  await expect(box).toBeHidden();
  await expect(trigger).toContainText('Buche');
  await expect(page.getByTestId('values')).toContainText('"art":"buche"');
});

test('multiple choice: badges in the trigger, Fertig (n) on the phone', async ({ page }, info) => {
  const trigger = page.getByRole('button', { name: 'Mischung' });
  await trigger.click();
  if (phone(info.project.name)) {
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Eiche').click();
    await dialog.getByText('Linde').click();
    await dialog.getByRole('button', { name: 'Done (2)' }).click();
    await expect(dialog).toBeHidden();
  } else {
    const list = page.getByRole('listbox');
    await list.getByText('Eiche').click();
    await list.getByText('Linde').click();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
  }
  await expect(trigger).toContainText('Eiche');
  await expect(trigger).toContainText('Linde');
  await expect(page.getByTestId('values')).toContainText('"mix":["eiche","linde"]');
});

test('phone: the dialog sits at 10 % and is 80 % of the viewport, the page behind is locked', async ({
  page,
}, info) => {
  test.skip(!phone(info.project.name));
  await page.getByRole('button', { name: 'Art' }).click();
  const dialog = page.getByRole('dialog');
  const box = await rect(dialog);
  expect(box.y).toBeCloseTo(84.4, 0);
  expect(box.height).toBeCloseTo(675.2, 0);
  expect(box.width).toBeCloseTo(390, 0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  const row = await rect(dialog.getByRole('radio', { name: 'Eiche' }));
  expect(row.height).toBeGreaterThanOrEqual(56);
  await page.screenshot({ path: test.info().outputPath('phone-dialog.png') });
});

test('desktop: the popover sits under the trigger and flips up near the bottom', async ({ page }, info) => {
  test.skip(phone(info.project.name));
  const trigger = page.getByRole('button', { name: 'Art' });
  await trigger.click();
  const list = page.getByRole('listbox');
  const t = await rect(trigger);
  const l = await rect(list);
  expect(l.y).toBeGreaterThan(t.y + t.height);
  expect(l.x).toBeCloseTo(t.x, -1);
  expect(l.height).toBeLessThanOrEqual(240 + 60);
  await page.screenshot({ path: test.info().outputPath('desktop-popover.png') });
  await page.keyboard.press('Escape');
  const low = page.getByRole('button', { name: 'Unten' });
  await low.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await low.click();
  const popover = page.getByRole('listbox');
  const lowBox = await rect(low);
  const popBox = await rect(popover);
  expect(popBox.y + popBox.height).toBeLessThanOrEqual(lowBox.y);
  await page.screenshot({ path: test.info().outputPath('desktop-popover-up.png') });
});
