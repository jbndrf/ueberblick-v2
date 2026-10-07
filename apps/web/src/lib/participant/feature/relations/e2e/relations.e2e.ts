import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../../../../e2e/a11y/axe';

/**
 * v3's relation path, relation level and run notices (WP-647) in the real shell at phone 390x844 and desktop 1280x800:
 * the path fits, the menu opens over the shell and stays on screen, the list and the notices work, no horizontal scroll.
 */

const noSideScroll = async (page: Page): Promise<void> => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};

test('the path shows the first parent, its relation and the current level; no horizontal scroll', async ({
  page,
}) => {
  await page.goto('/');
  const path = page.getByTestId('relation-path');
  await expect(path.getByRole('button', { name: 'Gebiet' })).toBeVisible();
  await expect(path.getByRole('button', { name: /Bäume/ })).toBeVisible();
  await expect(path.getByRole('button', { name: 'Verknüpfte Objekte' })).toContainText('Baum');
  const box = await path.boundingBox();
  expect(box !== null && box.x + box.width <= (page.viewportSize()?.width ?? 0)).toBe(true);
  await noSideScroll(page);
});

test('the current level opens a menu with the relations and their child counts, over the sheet and on screen', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Verknüpfte Objekte' }).click();
  const item = page.getByRole('menuitem', { name: /Maßnahme/ });
  await expect(item).toBeVisible();
  await expect(item).toContainText('1');
  const box = await item.boundingBox();
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  expect(
    box !== null && box.x >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height,
  ).toBe(true);
  await item.click();
  await expect(page.getByTestId('relation-row')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 3 })).toContainText('Maßnahme');
});

test('several parents: the switcher lists both chains and picks one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Übergeordnetes Objekt wechseln' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await page.getByRole('menuitem', { name: 'Gebiet' }).nth(1).click();
  await expect(page.getByTestId('relation-path')).toBeVisible();
});

test('the relation level lists children, open work first, finished greyed; a child opens', async ({
  page,
}) => {
  await page.goto('/?id=g1&group=baum.gebiet');
  const rows = page.getByTestId('relation-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Eiche');
  await expect(rows.nth(0).getByRole('img', { name: 'Offene Aufgaben für Sie' })).toBeVisible();
  await expect(rows.nth(2)).toContainText('Linde');
  await expect(rows.nth(2)).toHaveAttribute('data-finished', 'true');
  await expect(rows.nth(2)).toHaveCSS('opacity', '0.55');
  await noSideScroll(page);
  await rows.nth(0).click();
  await expect(page.getByTestId('relation-path').getByRole('button', { name: 'Gebiet' })).toBeVisible();
});

test('the relation level shows the labelled create button when creating is offered', async ({ page }) => {
  await page.goto('/?id=b1&group=massnahme.baum');
  await expect(page.getByRole('button', { name: 'Maßnahme anlegen' })).toBeVisible();
  await expect(page.getByTestId('relation-row')).toHaveCount(1);
});

test('a relation with no child says so', async ({ page }) => {
  await page.goto('/?id=m1&group=massnahme.baum');
  await expect(page.getByText('Noch keine Objekte')).toBeVisible();
});

test('run notices: the refused run with Erneut senden and Verwerfen, and the waiting count', async ({
  page,
}) => {
  await page.goto('/');
  const box = page.getByTestId('run-refused');
  await expect(box).toContainText('Kontrolle');
  await expect(box).toContainText('Ein Wert ist ungültig.');
  await expect(page.getByTestId('run-pending')).toContainText('Noch nicht übertragen: 1');
  await expect(box.getByRole('button', { name: 'Erneut senden' })).toBeVisible();
  await box.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByTestId('run-refused')).toHaveCount(0);
  await noSideScroll(page);
});

test('no axe violations (path, menu open, notices)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Verknüpfte Objekte' }).click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  const violations = await axeViolations(page, { rules: { region: { enabled: false } } });
  expect(violations).toEqual([]);
});

test('the map shows only the children of the open relation; leaving it ends that (v3 onFocusRelation)', async ({
  page,
}) => {
  const isolated = (): Promise<unknown> =>
    page.evaluate(() => (window as unknown as { __isolated: unknown }).__isolated);
  await page.goto('/?id=g1');
  expect(await isolated()).toBeNull();
  await page.getByRole('button', { name: 'Verknüpfte Objekte' }).click();
  await page.getByRole('menuitem', { name: /Bäume/ }).click();
  await expect(page.getByTestId('relation-row')).toHaveCount(3);
  expect(await isolated()).toEqual(['b1', 'b2', 'b3']);
  await page.getByTestId('relation-row').first().click(); // Eiche: reached through the relation, siblings stay
  await expect(page.getByTestId('relation-path')).toBeVisible();
  expect(await isolated()).toEqual(['b1', 'b2', 'b3']);
  await page.getByRole('button', { name: 'Gebiet' }).first().click();
  expect(await isolated()).toBeNull();
});
