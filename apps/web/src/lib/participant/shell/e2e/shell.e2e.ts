// WP-645: v3's map shell chrome at phone 390x844 and desktop 1280x800: header, bottom bar, the Werkzeuge badge, Zuletzt
// beside the detail, the + cycle and the tap on empty map.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../../../e2e/a11y/axe';

const isPhone = (name: string): boolean => name === 'phone';
const state = (page: Page): Locator => page.getByTestId('state');
const header = (page: Page): Locator => page.getByRole('banner');
const bar = (page: Page): Locator => page.getByRole('navigation', { name: 'Kartenleiste' });
const box = async (loc: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await loc.boundingBox();
  if (b === null) throw new Error('no layout');
  return b;
};
/** The + that the viewport has: the header's on a desktop, the bar's on a phone. */
const plus = (page: Page, phone: boolean): Locator =>
  phone
    ? bar(page).getByRole('button', { name: /Neu|Menü schließen/ })
    : header(page).getByRole('button', { name: 'Neu' });

test('the logo stands in for a missing project icon, inverted in the dark theme', async ({ page }) => {
  await page.goto('/');
  const logo = header(page).locator('img');
  await expect(logo).toHaveAttribute('src', '/icons/logo-light.png');
  await expect(logo).toHaveClass(/dark:invert/);
  await expect(header(page).getByText('Bäume')).toBeVisible();
});

test('the loading message and the sync text pulse in place of the name; the sync text goes first', async ({
  page,
}) => {
  await page.goto('/?loading=1');
  const msg = header(page).getByText('Objekte werden geladen ...');
  await expect(msg).toBeVisible();
  expect(await msg.evaluate((e) => getComputedStyle(e).animationName)).toBe('pulse');
  await page.goto('/?loading=1&syncing=1');
  await expect(header(page).getByText('Daten werden synchronisiert (120)')).toBeVisible();
  await expect(header(page).getByText('Objekte werden geladen ...')).toHaveCount(0);
});

test('the bar is the phone chrome, the header icons the desktop chrome (768 px)', async ({ page }, info) => {
  await page.goto('/');
  if (isPhone(info.project.name)) {
    await expect(bar(page)).toBeVisible();
    await expect(header(page).getByRole('button', { name: 'Filter' })).toBeHidden();
    const vp = page.viewportSize();
    const b = await box(bar(page));
    expect(Math.round(b.y + b.height)).toBe(vp?.height);
    expect(b.height).toBeGreaterThanOrEqual(64);
    expect(b.height).toBeLessThanOrEqual(66); // the 64 px buttons plus the border: no band below them (WP-699)
    const buttons = await bar(page)
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
    expect(Math.round(Math.max(...buttons))).toBeGreaterThanOrEqual((vp?.height ?? 0) - 1);
  } else {
    await expect(bar(page)).toBeHidden();
    await expect(header(page).getByRole('button', { name: 'Filter' })).toBeVisible();
  }
});

test('the Werkzeuge badge: 99+ on the bar (phone) or the header icon (desktop); a soft dot has no count', async ({
  page,
}, info) => {
  const where = isPhone(info.project.name) ? bar(page) : header(page);
  await page.goto('/?badge=big');
  await expect(where.getByText('99+')).toBeVisible();
  await page.goto('/?badge=soft');
  await expect(where.getByText('Ungelesen')).toHaveCount(1);
  await expect(where.getByText('99+')).toHaveCount(0);
  await page.goto('/');
  await expect(where.getByText('Ungelesen')).toHaveCount(0);
});

test('the + cycles Neu, Neu with Zuletzt, closed', async ({ page }, info) => {
  await page.goto('/');
  const p = plus(page, isPhone(info.project.name));
  await p.click();
  await expect(state(page)).toHaveText('create');
  await p.click();
  await expect(state(page)).toHaveText('create,recent');
  await p.click();
  await expect(state(page)).toHaveText('');
});

test('a row of Zuletzt opens the detail and Zuletzt stays; on a desktop it moves left of the 450 px panel', async ({
  page,
}, info) => {
  await page.goto('/');
  const recent = page.getByTestId('recent-sheet');
  const toggleRecent = isPhone(info.project.name)
    ? plus(page, true)
    : header(page).getByRole('button', { name: 'Zuletzt' });
  if (isPhone(info.project.name)) {
    await toggleRecent.click();
    await toggleRecent.click();
  } else await toggleRecent.click();
  await expect(recent).toBeVisible();
  await page.waitForTimeout(550); // the kit slides in over 500 ms
  const vp = page.viewportSize();
  if (vp === null) throw new Error('no viewport');
  const before = await box(recent);
  expect(Math.round(before.x + before.width)).toBe(vp.width);

  await page.getByTestId('recent-row').nth(2).click();
  await expect(state(page)).toContainText('recent');
  await expect(state(page)).toContainText('feature');
  await expect(page.getByTestId('detail-shell')).toHaveAttribute('data-open', 'true');
  await page.waitForTimeout(550);
  await expect(recent).toBeVisible();
  const after = await box(recent);
  if (isPhone(info.project.name)) {
    expect(Math.round(after.x + after.width)).toBe(vp.width);
  } else {
    expect(Math.round(after.x + after.width)).toBe(vp.width - 450);
    expect(await recent.evaluate((e) => getComputedStyle(e).zIndex)).toBe('1201');
  }
});

test('Zuletzt keeps its scroll position while a row is picked', async ({ page }, info) => {
  await page.goto('/');
  if (isPhone(info.project.name)) {
    await plus(page, true).click();
    await plus(page, true).click();
  } else await header(page).getByRole('button', { name: 'Zuletzt' }).click();
  const list = page.getByTestId('recent-list');
  await expect(list).toBeVisible();
  await page.waitForTimeout(550);
  await list.evaluate((e) => (e.scrollTop = 300));
  await page.getByTestId('recent-row').nth(8).click({ force: true });
  await expect(state(page)).toContainText('feature');
  await page.waitForTimeout(100);
  expect(await list.evaluate((e) => e.scrollTop)).toBeGreaterThan(250);
});

test('a tap on the empty map closes the detail, Neu and Zuletzt', async ({ page }, info) => {
  await page.goto('/');
  if (isPhone(info.project.name)) {
    await plus(page, true).click();
    await plus(page, true).click();
  } else await header(page).getByRole('button', { name: 'Zuletzt' }).click();
  await page.waitForTimeout(550);
  await page.getByTestId('recent-row').first().click();
  await expect(state(page)).toContainText('feature');
  await page.getByTestId('map').click({ position: { x: 20, y: 120 } });
  await expect(state(page)).toHaveText('');
});

test('has no axe violations', async ({ page }) => {
  await page.goto('/?badge=big');
  const violations = await axeViolations(page, { scope: 'body' });
  expect(violations).toEqual([]);
});

/** WCAG 2.5.5 (WP-656): every control of the chrome answers a tap anywhere in a 44 px square around its centre. */
test('header and bar controls have a 44 px tap target', async ({ page }, info) => {
  await page.goto('/');
  const where = isPhone(info.project.name) ? bar(page) : header(page);
  const small = await where.evaluate((root) => {
    const found: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('button, a[href]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      // Side by side the header icons are 40 px apart: horizontally the control's own width counts, the 44 is vertical.
      const hx = Math.min(21, r.width / 2 - 1);
      const miss = [
        [-hx, -21],
        [hx, -21],
        [-hx, 21],
        [hx, 21],
      ].some(([dx, dy]) => {
        const hit = document.elementFromPoint(cx + (dx ?? 0), cy + (dy ?? 0));
        return hit === null || !(el === hit || el.contains(hit));
      });
      if (miss)
        found.push(
          `${el.getAttribute('aria-label') ?? el.textContent?.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
    }
    return found;
  });
  expect(small).toEqual([]);
});
