// WP-641: the shared detail shell at phone 390x844 (draggable bottom sheet) and desktop 1280x800 (450 px right panel).
import { expect, test, type Locator, type Page } from '@playwright/test';

const shell = (page: Page): Locator => page.getByTestId('module-shell');
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

test('phone: 35 vh peek at the bottom; desktop: 450 px panel under the 56 px header', async ({
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
    await expect(shell(page)).toHaveAttribute('data-state', 'peek');
  } else {
    expect(b.width).toBe(450);
    expect(b.x + b.width).toBe(vp.width);
    expect(b.y).toBe(56);
    expect(Math.round(b.height)).toBe(vp.height - 56);
    await expect(shell(page)).toHaveAttribute('data-state', 'full');
  }
});

test('phone: a tap on the header toggles 35 and 90 vh; the cluster detail uses 35 and 75', async ({
  page,
}, info) => {
  test.skip(!isPhone(info.project.name), 'the panel has no height to toggle');
  await open(page);
  const vp = page.viewportSize();
  if (vp === null) throw new Error('no viewport');
  await page.getByRole('button', { name: 'Größe ändern' }).click();
  await page.waitForTimeout(350);
  expect(Math.abs((await box(shell(page))).height - vp.height * 0.9)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Größe ändern' }).click();
  await page.waitForTimeout(350);
  expect(Math.abs((await box(shell(page))).height - vp.height * 0.35)).toBeLessThan(2);
  await open(page, '?cluster=1');
  await page.getByRole('button', { name: 'Größe ändern' }).click();
  await page.waitForTimeout(350);
  expect(Math.abs((await box(shell(page))).height - vp.height * 0.75)).toBeLessThan(2);
});

test('phone: dragging the header up expands, down collapses, and from peek closes', async ({
  page,
}, info) => {
  test.skip(!isPhone(info.project.name), 'drag is a phone gesture');
  await open(page);
  const grab = await box(page.getByRole('button', { name: 'Größe ändern' }));
  const x = grab.x + grab.width / 3;
  const y = grab.y + grab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 120, { steps: 6 });
  await page.mouse.up();
  await expect(shell(page)).toHaveAttribute('data-state', 'full');
  await page.waitForTimeout(350);
  const g2 = await box(page.getByRole('button', { name: 'Größe ändern' }));
  await page.mouse.move(x, g2.y + 20);
  await page.mouse.down();
  await page.mouse.move(x, g2.y + 20 + 120, { steps: 6 });
  await page.mouse.up();
  await expect(shell(page)).toHaveAttribute('data-state', 'peek');
  await page.waitForTimeout(350);
  const g3 = await box(page.getByRole('button', { name: 'Größe ändern' }));
  await page.mouse.move(x, g3.y + 20);
  await page.mouse.down();
  await page.mouse.move(x, g3.y + 20 + 120, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('result')).toContainText('closes=1');
  await expect(shell(page)).toHaveAttribute('data-open', 'false');
});

test('closing slides the shell out of the screen; it is still in the page, and cannot take focus', async ({
  page,
}, info) => {
  await open(page);
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(shell(page)).toHaveAttribute('data-open', 'false');
  await page.waitForTimeout(350);
  const vp = page.viewportSize();
  if (vp === null) throw new Error('no viewport');
  const b = await box(shell(page));
  if (isPhone(info.project.name)) expect(Math.round(b.y)).toBeGreaterThanOrEqual(vp.height);
  else expect(Math.round(b.x)).toBeGreaterThanOrEqual(vp.width);
  await expect(shell(page)).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await expect(shell(page)).toHaveAttribute('data-open', 'true');
});

test('Escape closes; the map under the shell stays usable (no scrim)', async ({ page }) => {
  await open(page);
  await page.getByTestId('map').click();
  await expect(page.getByTestId('result')).toContainText('map=1');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('result')).toContainText('closes=1');
});

test('header: title, subtitle and the badge on the primary colour; header actions; footer', async ({
  page,
}) => {
  await open(page, '?badge=Pr%C3%BCfung');
  await expect(page.getByRole('heading', { level: 3, name: 'Baum' })).toBeVisible();
  await expect(page.getByTestId('module-shell-subtitle')).toHaveText('Alte Eiche');
  await expect(page.getByTestId('module-shell-badge')).toHaveText('Prüfung');
  await expect(page.getByTestId('header-action')).toBeVisible();
  await expect(page.getByTestId('footer')).toBeVisible();
  const bg = await shell(page)
    .locator('.bg-primary')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('loading, error and empty states use v3 labels, and the footer hides while loading or failed', async ({
  page,
}) => {
  await open(page, '?state=loading');
  await expect(page.getByText('Wird geladen...')).toBeVisible();
  await expect(page.getByTestId('footer')).toHaveCount(0);
  await open(page, '?state=error');
  await expect(page.getByText('Fehler', { exact: true })).toBeVisible();
  await expect(page.getByText('Nicht gefunden')).toBeVisible();
  await open(page, '?state=empty');
  await expect(page.getByText('Kein Inhalt')).toBeVisible();
  await expect(page.getByTestId('footer')).toBeVisible();
});

test('the body scrolls inside the shell; the page does not', async ({ page }) => {
  await open(page);
  const body = page.getByTestId('body').locator('..');
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
