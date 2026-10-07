// WP-653: v3's cluster detail at phone 390x844 (35 vh peek, 75 vh expanded) and desktop 1280x800 (the 450 px panel).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../../../e2e/a11y/axe';

const shell = (page: Page): Locator => page.getByTestId('cluster-sheet');
const open = async (page: Page, query = ''): Promise<void> => {
  await page.goto(`/${query}`);
  await expect(shell(page)).toHaveAttribute('data-open', 'true');
  await page.waitForTimeout(350); // the slide-in is 300 ms
};
const box = async (loc: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await loc.boundingBox();
  if (b === null) throw new Error('no layout');
  return b;
};
const isPhone = (name: string): boolean => name === 'phone';

test('phone: 35 vh peek at the bottom, 75 vh expanded; desktop: the 450 px panel under the 56 px header', async ({
  page,
}, info) => {
  await open(page);
  const vp = page.viewportSize();
  if (vp === null) throw new Error('no viewport');
  const b = await box(shell(page));
  if (isPhone(info.project.name)) {
    expect(b.width).toBe(vp.width);
    expect(Math.abs(b.height - vp.height * 0.35)).toBeLessThan(2);
    expect(Math.round(b.y + b.height)).toBe(vp.height);
    await page.getByRole('button', { name: 'Gruppe vergrößern oder verkleinern' }).click();
    await page.waitForTimeout(350);
    expect(Math.abs((await box(shell(page))).height - vp.height * 0.75)).toBeLessThan(2);
  } else {
    expect(b.width).toBe(450);
    expect(b.x + b.width).toBe(vp.width);
    expect(b.y).toBe(56);
  }
});

test('title, subtitle and one block per Objektart with a row per stage: dot, label, count, bar and percent', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('heading', { level: 3, name: '6 Objekte' })).toBeVisible();
  await expect(page.getByTestId('cluster-sheet-subtitle')).toHaveText('2 Objektarten');
  await expect(page.getByRole('heading', { level: 4 })).toHaveText(['Baum', 'Bank']);
  const first = page.getByTestId('cluster-row').first();
  await expect(first).toContainText('Erfasst');
  await expect(first).toContainText('3 Objekte');
  await expect(first).toContainText('60%');
  await expect(first.locator('.rounded-full').first()).toBeVisible();
  await expect(page.getByTestId('cluster-row').nth(1)).toContainText('1 Objekt');
});

test('rows take the colour the map draws the value in; a value with none is drawn in the default marker colour (WP-674)', async ({
  page,
}) => {
  await open(page);
  const dot = (i: number) => page.getByTestId('cluster-row').nth(i).locator('.rounded-full').first();
  await expect(dot(0)).toHaveCSS('background-color', 'rgb(22, 163, 74)'); // erfasst
  await expect(dot(1)).toHaveCSS('background-color', 'rgb(202, 138, 4)'); // kontrolliert
  await expect(dot(2)).toHaveCSS('background-color', 'rgb(99, 102, 241)'); // erledigt: no entry, the map's fallback dot
});

test('the rows group by the classifying property when it is not the stage', async ({ page }) => {
  await open(page, '?by=zustand');
  await expect(page.getByTestId('cluster-row').first()).toContainText('Gut');
  await expect(page.getByTestId('cluster-row').first()).toContainText('3 Objekte'); // b0, b2, b4
  await expect(page.getByTestId('cluster-row').nth(1)).toContainText('Schlecht');
  await expect(page.getByTestId('cluster-row').first().locator('.rounded-full').first()).toHaveCSS(
    'background-color',
    'rgb(22, 163, 74)',
  );
});

test('a row isolates its members; the same row ends it; a tap on the map closes the sheet and ends it', async ({
  page,
}) => {
  await open(page);
  const first = page.getByTestId('cluster-row').first();
  await first.click();
  await expect(page.getByTestId('log')).toContainText('isolate:b0,b1,b2;');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toHaveClass(/ring-primary\/30/);
  await first.click();
  await expect(page.getByTestId('log')).toContainText('isolate:null;');
  await first.click();
  await page.getByTestId('map').click(); // not modal: the map under the sheet takes the tap
  await expect(page.getByTestId('result')).toContainText('open=false');
  await expect(page.getByTestId('log')).toContainText(
    'isolate:b0,b1,b2;isolate:null;isolate:b0,b1,b2;isolate:null;',
  );
});

test('one Objektart reads "Objektart"', async ({ page }) => {
  await open(page, '?types=1');
  await expect(page.getByTestId('cluster-sheet-subtitle')).toHaveText('Objektart');
});

test('has no axe violations', async ({ page }) => {
  await open(page);
  const violations = await axeViolations(page, { scope: 'body' });
  expect(violations).toEqual([]);
});
