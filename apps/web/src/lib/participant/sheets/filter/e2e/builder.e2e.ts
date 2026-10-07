import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../../../../e2e/a11y/axe';

/**
 * v3's FilterBuilder under the active saved view (WP-665), at phone 390x844 and desktop 1280x800. The harness shows the
 * ids that pass the written view, evaluated by core's `applyFilter`, in place of the map.
 */

test.beforeEach(async ({ page }, info) => {
  // `phoneAndDesktop()` is Pixel 7; the owner's phone is 390x844.
  if (info.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/builder.html');
  await expect(page.getByText('Felder filtern')).toBeVisible();
});

const shown = (page: Page) => page.getByTestId('shown');
const source = (page: Page) => page.getByTestId('source');

test('the builder opens under the active view; with no rows every Objekt passes', async ({ page }) => {
  await expect(page.getByRole('radio', { name: /Meine Ansicht/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weitere Bedingung hinzufügen' })).toBeVisible();
  await expect(shown(page)).toHaveText('t1,t2,t3,t4');
});

test('Felder filtern: pick a text field through the kit picker, type, and the map shows the match', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Felder zum Filtern hinzufügen/ }).click();
  await page
    .getByRole('option', { name: /^Befund/ })
    .or(page.getByRole('checkbox', { name: /^Befund/ }))
    .click();
  // a phone shows the picker as a full-screen dialog with "Fertig"
  const done = page.getByRole('button', { name: /Fertig|Done/ });
  if (await done.isVisible()) await done.click();
  await page.getByPlaceholder('Enthält…').fill('Pilz');
  await expect(shown(page)).toHaveText('t1,t3');
  await expect(source(page)).toContainText('self.befund.contains(\\"Pilz\\")');
});

test('a number range and the date-free rows combine with AND', async ({ page }) => {
  await page.getByRole('button', { name: /Felder zum Filtern hinzufügen/ }).click();
  await page
    .getByRole('option', { name: /^Höhe/ })
    .or(page.getByRole('checkbox', { name: /^Höhe/ }))
    .click();
  const done = page.getByRole('button', { name: /Fertig|Done/ });
  if (await done.isVisible()) await done.click();
  await page.getByPlaceholder('Min').fill('5');
  await expect(shown(page)).toHaveText('t2,t3,t4');
  await page.getByPlaceholder('Max').fill('15');
  await expect(shown(page)).toHaveText('t2,t4');
});

test('Stufe: the stages of the Objektart as checkboxes', async ({ page }) => {
  await page.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }).click();
  await page.getByRole('menuitem', { name: 'Stufe' }).click();
  await page.getByRole('checkbox', { name: 'Erledigt' }).click();
  await expect(shown(page)).toHaveText('t2');
});

test('Erstellt von lists people by name, never by id', async ({ page }) => {
  await page.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }).click();
  await page.getByRole('menuitem', { name: 'Erstellt von' }).click();
  const row = page.locator('[data-clause="created_by"]');
  await expect(row.getByText('Anton')).toBeVisible();
  await expect(row.getByText('Berta')).toBeVisible();
  await expect(row.getByText('Jemand')).toBeVisible();
  await expect(row).not.toContainText(/\bu[123]\b/);
  await row.getByRole('checkbox', { name: 'Anton' }).click();
  await expect(shown(page)).toHaveText('t2,t3');
});

test('Erstellungsdatum: older than N days (core counts from "now")', async ({ page }) => {
  await page.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }).click();
  await page.getByRole('menuitem', { name: 'Erstellungsdatum' }).click();
  const row = page.locator('[data-clause="when"]');
  await row.getByRole('spinbutton').fill('30');
  await row.getByRole('spinbutton').blur();
  await expect(shown(page)).toHaveText('t1');
});

test('removing a row brings the Objekte back; no horizontal scroll', async ({ page }) => {
  await page.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }).click();
  await page.getByRole('menuitem', { name: 'Stufe' }).click();
  await page.getByRole('checkbox', { name: 'Erledigt' }).click();
  await expect(shown(page)).toHaveText('t2');
  await page.getByRole('button', { name: 'Bedingung entfernen' }).click();
  await expect(shown(page)).toHaveText('t1,t2,t3,t4');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('no axe violations with rows open', async ({ page }) => {
  await page.getByRole('button', { name: 'Weitere Bedingung hinzufügen' }).click();
  await page.getByRole('menuitem', { name: 'Erstellt von' }).click();
  const violations = await axeViolations(page);
  expect(violations).toEqual([]);
});
