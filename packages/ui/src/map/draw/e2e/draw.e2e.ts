// WP-635: drawing on the real map, at phone 390x844 and desktop 1280x800. Labels are v3's German ones.
import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page, query: string): Promise<void> => {
  await page.goto(`/?${query}`);
  await expect(page.getByRole('toolbar', { name: 'Zeichenwerkzeug' })).toBeVisible();
  // the map is drawn before the first tap counts
  await page.waitForFunction(() => document.querySelector('.maplibregl-canvas') !== null);
  await page.waitForTimeout(400);
};
const tap = async (page: Page, x: number, y: number): Promise<void> => {
  await page.mouse.click(x, y);
};
const result = async (page: Page): Promise<unknown> => {
  const text = await page.getByTestId('result').textContent();
  return text === null || text === '' ? undefined : JSON.parse(text);
};

test('the control stack sits top right, inside the screen, with v3 touch sizes', async ({ page }) => {
  await open(page, 'kind=polygon&multi=1');
  const bar = await page.getByRole('toolbar', { name: 'Zeichenwerkzeug' }).boundingBox();
  const vp = page.viewportSize();
  if (bar === null || vp === null) throw new Error('no layout');
  expect(bar.x + bar.width).toBeLessThanOrEqual(vp.width);
  expect(bar.x + bar.width).toBeGreaterThan(vp.width - 24);
  expect(bar.y).toBeLessThan(24);
  const size = (await page.getByRole('button', { name: 'Abbrechen' }).boundingBox())?.width;
  expect(size).toBe(vp.width < 768 ? 40 : 36);
  await expect(page.getByRole('button', { name: 'Fertig' })).toBeDisabled();
});

test('an area: three taps, Fertig gives a Polygon', async ({ page }) => {
  await open(page, 'kind=polygon');
  await tap(page, 100, 300);
  await tap(page, 220, 300);
  await tap(page, 220, 420);
  await page.getByRole('button', { name: 'Fertig' }).click();
  const g = (await result(page)) as { type: string; coordinates: number[][][] };
  expect(g.type).toBe('Polygon');
  expect(g.coordinates[0]).toHaveLength(4);
});

test('several parts: Neues Element, undo, Fertig give a MultiLineString', async ({ page }) => {
  await open(page, 'kind=linestring&multi=1');
  await tap(page, 100, 300);
  await tap(page, 200, 300);
  await page.getByRole('button', { name: 'Neues Element' }).click();
  await expect(page.getByRole('button', { name: 'Element 2' })).toBeVisible();
  await tap(page, 100, 400);
  await tap(page, 200, 400);
  await tap(page, 200, 500);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await page.getByRole('button', { name: 'Fertig' }).click();
  const g = (await result(page)) as { type: string; coordinates: number[][][] };
  expect(g.type).toBe('MultiLineString');
  expect(g.coordinates.map((l) => l.length)).toEqual([2, 2]);
});

test('a double tap while drawing adds a vertex and does not zoom', async ({ page }) => {
  await open(page, 'kind=linestring');
  const zoom = (): Promise<number> => page.evaluate(() => Number(document.body.dataset['zoom'] ?? NaN));
  const before = await zoom();
  await page.mouse.dblclick(150, 300);
  await page.waitForTimeout(600);
  // the second tap lands on the new vertex (a marker), so one vertex; with zoom on, the map would have zoomed in
  await expect(page.locator('.ub-draw-vertex')).toHaveCount(1);
  expect(await zoom()).toBe(before);
});

test('a tap on the first vertex closes an area and the next part starts', async ({ page }) => {
  await open(page, 'kind=polygon&multi=1');
  await tap(page, 100, 300);
  await tap(page, 220, 300);
  await tap(page, 220, 420);
  await page.locator('.ub-draw-vertex').first().click();
  await expect(page.getByRole('button', { name: 'Element 2' })).toBeVisible();
  await tap(page, 300, 500);
  await expect(page.locator('.ub-draw-vertex')).toHaveCount(4);
});

test('a vertex can be dragged', async ({ page }) => {
  await open(page, 'kind=linestring');
  await tap(page, 100, 300);
  await tap(page, 200, 300);
  const second = page.locator('.ub-draw-vertex').nth(1);
  const box = await second.boundingBox();
  if (box === null) throw new Error('no vertex');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y + 60, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Fertig' }).click();
  const g = (await result(page)) as { coordinates: number[][] };
  // the second vertex moved south (lower latitude); the first stayed
  expect(g.coordinates[1]?.[1]).toBeLessThan(g.coordinates[0]?.[1] ?? 0);
});

test('a self-intersecting area is refused with the reason and stays on the map', async ({ page }) => {
  await open(page, 'kind=polygon');
  await tap(page, 100, 300);
  await tap(page, 220, 420);
  await tap(page, 220, 300);
  await tap(page, 100, 420);
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByRole('alert')).toHaveText('Nicht übernommen: die Form überschneidet sich selbst.');
  expect(await result(page)).toBeUndefined();
  await expect(page.locator('.ub-draw-vertex')).toHaveCount(4);
});

test('Abbrechen leaves nothing on the map', async ({ page }) => {
  await open(page, 'kind=linestring');
  await tap(page, 100, 300);
  await tap(page, 200, 300);
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  expect(await page.getByTestId('result').textContent()).toBe('cancelled');
});
