// WP-677 (B-019): the family fan over the real map at phone 390x844 and desktop 1280x800. Children that sit at their
// parent are not drawn until the relation is opened; then at most five icons and a "+N" chip stand above the parent,
// each a 44 px target on screen, and a tap opens that child (the chip opens the parent).
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../../../e2e/a11y/axe';

const open = async (page: Page, query = ''): Promise<void> => {
  await page.goto(`/?scene=family&${query}`);
  await page.waitForFunction(() => document.querySelector('.maplibregl-canvas') !== null);
  await page.waitForTimeout(500);
};
const violations = async (page: Page): Promise<string[]> => {
  return axeViolations(page, { scope: 'body', rules: { 'color-contrast': { enabled: false } } });
};
const fanButtons = (page: Page) => page.locator('.maplibregl-marker button');
/** Opens the relation and waits for the pop-in (five items 35 ms apart plus 160 ms) to end, so boxes are at rest. */
const openRelation = async (page: Page): Promise<void> => {
  await page.getByTestId('open-relation').click();
  await page.waitForTimeout(450);
};

test('nothing is drawn for the children until the relation is opened', async ({ page }) => {
  await open(page);
  await expect(fanButtons(page)).toHaveCount(0);
});

test('seven children: five icons and a +2 chip stand above the parent, on screen, each a 44 px target', async ({
  page,
}) => {
  await open(page);
  await openRelation(page);
  await expect(fanButtons(page)).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Alle 7 verknüpften Einträge anzeigen' })).toContainText(
    '+2',
  );
  const parent = await page.locator('.maplibregl-marker').first().boundingBox();
  const vp = page.viewportSize();
  if (parent === null || vp === null) throw new Error('no box');
  let lastTop = Infinity;
  for (const b of await fanButtons(page).all()) {
    const box = await b.boundingBox();
    if (box === null) throw new Error('no box');
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(parent.y + 1); // above the parent
    expect(box.y + box.height).toBeLessThanOrEqual(lastTop + 1); // each one above the one before
    lastTop = box.y;
  }
  expect(await violations(page)).toEqual([]);
});

test('a tap on a child opens that child; the chip opens the parent', async ({ page }) => {
  await open(page);
  await openRelation(page);
  await page.getByRole('button', { name: 'Maßnahme m0' }).click();
  await expect(page.getByTestId('opened')).toHaveText('m0');
  await page.getByRole('button', { name: 'Alle 7 verknüpften Einträge anzeigen' }).click();
  await expect(page.getByTestId('opened')).toHaveText('parent b1');
});

test('the fan stays glued to the parent while the map is dragged', async ({ page }) => {
  await open(page);
  await openRelation(page);
  const parent = () => page.locator('.maplibregl-marker').first().boundingBox();
  const p0 = await parent();
  const f0 = await fanButtons(page).first().boundingBox();
  if (p0 === null || f0 === null) throw new Error('no box');
  await page.mouse.move(200, 400);
  await page.mouse.down();
  await page.mouse.move(150, 430, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const p1 = await parent();
  const f1 = await fanButtons(page).first().boundingBox();
  if (p1 === null || f1 === null) throw new Error('no box');
  expect(Math.abs(f1.x - f0.x - (p1.x - p0.x))).toBeLessThan(3);
  expect(Math.abs(f1.y - f0.y - (p1.y - p0.y))).toBeLessThan(3);
  await expect(fanButtons(page)).toHaveCount(6);
});

test('a tap on the empty map collapses the fan', async ({ page }) => {
  await open(page);
  await openRelation(page);
  await page.getByTestId('map').click({ position: { x: 30, y: 300 } });
  await expect(fanButtons(page)).toHaveCount(0);
});

test('closing the relation takes the fan away', async ({ page }) => {
  await open(page);
  await openRelation(page);
  await expect(fanButtons(page)).toHaveCount(6);
  await page.getByTestId('close-relation').click();
  await expect(fanButtons(page)).toHaveCount(0);
});

test('a few children: no chip', async ({ page }) => {
  await open(page, 'n=3');
  await openRelation(page);
  await expect(fanButtons(page)).toHaveCount(3);
});
