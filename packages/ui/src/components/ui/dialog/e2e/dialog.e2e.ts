// WP-663: bits-ui's `contain: layout style` on the dialog content must not clip a MultiSelect inside it.
// Phone (390x844) and desktop (1280x800): the viewport is pinned per project, whatever the device profile says.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../../../e2e/a11y/axe';

const SIZES: Record<string, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

async function inside(l: Locator, vw: number, vh: number): Promise<void> {
  const b = await l.boundingBox();
  if (b === null) throw new Error('element has no box');
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vw + 0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(vh + 0.5);
}

/** The open choice list: v3's full-screen dialog on the phone, the dropdown (a listbox) on the desktop. */
const panel = (page: Page, project: string): Locator =>
  project === 'phone' ? page.getByRole('dialog', { name: 'Select options' }) : page.getByRole('listbox');

test.beforeEach(async ({ page }, info) => {
  const size = SIZES[info.project.name];
  if (size === undefined) throw new Error(`unknown project ${info.project.name}`);
  await page.setViewportSize(size);
  await page.goto('/');
});

test('the dialog content has no containment', async ({ page }) => {
  const content = page.locator('[data-slot="dialog-content"]');
  await expect(content).toBeVisible();
  await expect(content).toHaveCSS('contain', 'none');
});

test('a MultiSelect opens inside the viewport and its options can be picked', async ({ page }, info) => {
  const size = SIZES[info.project.name] ?? { width: 0, height: 0 };
  await page.getByRole('button', { name: /Select options/ }).click();
  const list = panel(page, info.project.name);
  await expect(list).toBeVisible();
  await inside(list, size.width, size.height);
  for (const label of ['Eiche', 'Kiefer']) {
    const opt = list.getByText(label, { exact: true });
    await expect(opt).toBeVisible();
    await inside(opt, size.width, size.height);
  }
  await list.getByText('Eiche', { exact: true }).click();
  await list.getByText('Kiefer', { exact: true }).click();
  await expect(page.getByTestId('values')).toHaveText('eiche,kiefer');
});

const axeClean = async (page: Page): Promise<void> => {
  const violations = await axeViolations(page);
  expect(violations).toEqual([]);
};

test('no axe violations with the select open', async ({ page }, info) => {
  await page.getByRole('button', { name: /Select options/ }).click();
  await expect(panel(page, info.project.name)).toBeVisible();
  await axeClean(page);
});

test('a Popover inside a Dialog opens in the viewport and is clickable', async ({ page }, info) => {
  const size = SIZES[info.project.name] ?? { width: 0, height: 0 };
  await page.getByRole('button', { name: 'Popover' }).click();
  const item = page.getByRole('button', { name: 'Inside popover' });
  await expect(item).toBeVisible();
  await inside(item, size.width, size.height);
  await axeClean(page);
  await item.click();
  await expect(page.getByTestId('picked')).toHaveText('popover');
});

test('a DropdownMenu inside a Dialog opens in the viewport and is clickable', async ({ page }, info) => {
  const size = SIZES[info.project.name] ?? { width: 0, height: 0 };
  await page.getByRole('button', { name: 'Menu' }).click();
  const item = page.getByRole('menuitem', { name: 'Menu item' });
  await expect(item).toBeVisible();
  await inside(item, size.width, size.height);
  await axeClean(page);
  await item.click();
  await expect(page.getByTestId('picked')).toHaveText('menu');
});

test('a Tooltip inside a Dialog is visible in the viewport and not covered', async ({ page }, info) => {
  const size = SIZES[info.project.name] ?? { width: 0, height: 0 };
  await page.getByRole('button', { name: 'Tip' }).hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toBeVisible();
  await inside(tip, size.width, size.height);
  await axeClean(page);
  const b = await tip.boundingBox();
  if (b === null) throw new Error('tooltip has no box');
  const topmost = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-slot="tooltip-content"]') !== null,
    { x: b.x + b.width / 2, y: b.y + b.height / 2 },
  );
  expect(topmost).toBe(true);
});
