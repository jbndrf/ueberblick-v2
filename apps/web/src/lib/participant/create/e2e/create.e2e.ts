// WP-652: the + flow over the real map at phone 390x844 and desktop 1280x800, with the v3 numbers: the picker's place
// and stagger, the left position beside Zuletzt, the red pill at bottom-20 (lg:bottom-8), the bar that hides, the pin
// that is dragged and the form that gets its position.
import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../../../e2e/a11y/axe';

const open = async (page: Page, query = ''): Promise<void> => {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => document.querySelector('.maplibregl-canvas') !== null);
  await page.waitForTimeout(500);
};
const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 768;
/** The + : the raised bar button on a phone, the header button from 768 px. */
const plus = (page: Page) =>
  isPhone(page)
    ? page.getByRole('navigation', { name: 'Kartenleiste' }).locator('.center-button')
    : page.getByTestId('header-plus');

const violations = async (page: Page): Promise<string[]> => {
  return axeViolations(page, { scope: 'body' });
};

test('+ opens the picker: pills stagger in (0.2 s, 0.03 s apart) above the + on a phone, below the header on desktop', async ({
  page,
}) => {
  await open(page);
  await plus(page).click();
  const group = page.getByTestId('create-picker');
  await expect(group).toBeVisible();
  const pills = page.getByTestId('create-pill');
  await expect(pills).toHaveCount(3);
  const delays = await pills.evaluateAll((els) =>
    els.map((e) => [getComputedStyle(e).animationDelay, getComputedStyle(e).animationDuration]),
  );
  expect(delays).toEqual([
    ['0s', '0.2s'],
    ['0.03s', '0.2s'],
    ['0.06s', '0.2s'],
  ]);
  const box = await group.boundingBox();
  const vp = page.viewportSize();
  if (box === null || vp === null) throw new Error('no box');
  expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(2); // centred
  if (isPhone(page))
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height - 80 + 1); // above the bar (bottom-20)
  else expect(box.y).toBeGreaterThanOrEqual(64 - 1); // below the header (header height + 0.5rem)
  expect(await violations(page)).toEqual([]);
});

test('on desktop the picker follows --ub-header-h and never overlaps a taller header (WP-732)', async ({
  page,
}) => {
  test.skip(isPhone(page), 'the picker is bottom-anchored on a phone');
  await open(page);
  await plus(page).click();
  const group = page.getByTestId('create-picker');
  await expect(group).toBeVisible();
  const before = await group.boundingBox();
  await page.evaluate(() => document.documentElement.style.setProperty('--ub-header-h', '6rem'));
  const after = await group.boundingBox();
  if (before === null || after === null) throw new Error('no box');
  expect(after.y).toBeCloseTo(before.y + 2.5 * 16, 0);
  expect(after.y).toBeGreaterThanOrEqual(96); // below the 6rem header
});

test('the second + press adds Zuletzt and the picker moves to the left half; the backdrop closes both', async ({
  page,
}) => {
  await open(page);
  await plus(page).click();
  await plus(page).click();
  await expect(page.getByTestId('recent')).toBeVisible();
  const box = await page.getByTestId('create-picker').boundingBox();
  if (box === null) throw new Error('no box');
  expect(box.x).toBeCloseTo(isPhone(page) ? 16 : 64, 0); // left-4 md:left-16
  await page.mouse.click(box.x + box.width + 30, box.y + 10, { delay: 10 });
  await expect(page.getByTestId('create-picker')).toHaveCount(0);
  await expect(page.getByTestId('recent')).toHaveCount(0);
});

test('a role at its quota gets the hint and the pills cannot be pressed', async ({ page }) => {
  await open(page, 'quota=1');
  await plus(page).click();
  await expect(page.getByRole('status')).toContainText('Limit erstellter Einträge');
  await expect(page.getByTestId('create-pill').first()).toBeDisabled();
});

test('a point type: the pin, the red pill at bottom-20 (bottom-8 from 1024 px), the bar hides, the form gets the pin', async ({
  page,
}) => {
  await open(page);
  await plus(page).click();
  await page.getByText('Baum erfassen').click();
  const pill = page.getByTestId('placement-confirm').locator('..');
  await expect(pill).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Kartenleiste' })).toHaveCount(0);
  const vp = page.viewportSize();
  const pb = await pill.boundingBox();
  if (vp === null || pb === null) throw new Error('no box');
  expect(Math.round(vp.height - (pb.y + pb.height))).toBe(vp.width >= 1024 ? 32 : 80);
  expect(await pill.evaluate((e) => getComputedStyle(e).borderRadius)).not.toBe('0px');
  await expect(page.locator('.ub-placement-pin-dot')).toBeVisible();
  expect(await violations(page)).toEqual([]);
  // a tap moves the pin; the confirmed point follows it
  await page.getByTestId('map').click({ position: { x: 60, y: 200 } });
  await page.getByTestId('placement-confirm').click();
  const geometry = JSON.parse((await page.getByTestId('form-geometry').textContent()) ?? 'null') as {
    type: string;
    coordinates: number[];
  };
  expect(geometry.type).toBe('Point');
  expect(geometry.coordinates[0]).not.toBeCloseTo(7.1, 3); // not the map's middle any more
  await expect(page.getByTestId('form-task')).toHaveText('erfassen');
  // the pin set the position, it is no form row (WP-697); the real form model builds the rows
  await expect(page.getByTestId('form-rows').locator('li')).toHaveText(['beschreibung']);
});

test('the pin can be dragged, and the dashed line follows it', async ({ page }) => {
  await open(page);
  await plus(page).click();
  await page.getByText('Baum erfassen').click();
  const dot = page.locator('.ub-placement-pin-dot');
  const b = await dot.boundingBox();
  if (b === null) throw new Error('no pin');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 80, b.y - 60, { steps: 8 });
  await page.mouse.up();
  const after = await dot.boundingBox();
  expect(after && Math.abs(after.x - b.x)).toBeGreaterThan(40);
});

test('the cross cancels the placement: the bar is back and the pin is gone', async ({ page }) => {
  await open(page);
  await plus(page).click();
  await page.getByText('Baum erfassen').click();
  await page.getByTestId('placement-cancel').click();
  await expect(page.locator('.ub-placement-pin-dot')).toHaveCount(0);
  if (isPhone(page)) await expect(page.getByRole('navigation', { name: 'Kartenleiste' })).toBeVisible();
});

// WP-677: "Mit Eltern-Element verketten" over the real map. The chip, the hint, a ring on each candidate parent (each a
// 44 px target), the pin that snaps onto the parent, and the form that starts with the parent linked.
const chip = (page: Page) => page.getByRole('button', { name: 'Mit Eltern-Element verketten' });
const within = async (page: Page, el: ReturnType<Page['locator']>): Promise<void> => {
  const box = await el.boundingBox();
  const vp = page.viewportSize();
  if (box === null || vp === null) throw new Error('no box');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
};

test('verketten: the chip is on screen and there are no rings until it is armed', async ({ page }) => {
  await open(page, 'chain=1');
  await plus(page).click();
  await page.getByText('Baum erfassen').click();
  await within(page, chip(page));
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('chain-candidate')).toHaveCount(0);
});

test('verketten: armed shows the hint and a ring on each parent; a tap snaps the pin and starts the form with the parent', async ({
  page,
}) => {
  await open(page, 'chain=1');
  await plus(page).click();
  await page.getByText('Baum erfassen').click();
  await chip(page).click();
  await expect(page.getByRole('status')).toContainText('Tippe auf das Eltern-Element');
  const rings = page.getByTestId('chain-candidate');
  await expect(rings).toHaveCount(2);
  for (const ring of await rings.all()) {
    const b = await ring.boundingBox();
    expect(b?.width).toBeGreaterThanOrEqual(44);
    expect(b?.height).toBeGreaterThanOrEqual(44);
    await within(page, ring);
  }
  expect(await violations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Gebiet Süd als Eltern-Element wählen' }).click();
  await expect(page.getByRole('status')).toHaveCount(0); // picked: the hint goes
  await page.getByTestId('placement-confirm').click();
  await expect(page.getByTestId('form-parent')).toHaveText('gebiet=g2');
  const geometry = JSON.parse((await page.getByTestId('form-geometry').textContent()) ?? 'null') as {
    coordinates: number[];
  };
  expect(geometry.coordinates[0]).toBeCloseTo(7.104, 5); // the pin is where the parent is
  expect(geometry.coordinates[1]).toBeCloseTo(50.703, 5);
});

test('verketten: closing the chain again is standalone creation with no parent', async ({ page }) => {
  await open(page, 'chain=1');
  await plus(page).click();
  await page.getByText('Baum erfassen').click();
  await chip(page).click();
  await page.getByRole('button', { name: 'Gebiet Nord als Eltern-Element wählen' }).click();
  await chip(page).click();
  await expect(page.getByTestId('chain-candidate')).toHaveCount(0);
  await page.getByTestId('placement-confirm').click();
  await expect(page.getByTestId('form-parent')).toHaveText('');
});

test('a type at its parent: no pin and no chip, the parent is tapped and the form opens with it linked', async ({
  page,
}) => {
  await open(page, 'inherit=1');
  await plus(page).click();
  await page.getByText('Maßnahme anlegen').click();
  await expect(page.locator('.ub-placement-pin-dot')).toHaveCount(0);
  await expect(page.getByTestId('placement-confirm')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Tippe auf das Eltern-Element');
  if (isPhone(page)) await expect(page.getByRole('navigation', { name: 'Kartenleiste' })).toHaveCount(0);
  expect(await violations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Gebiet Nord als Eltern-Element wählen' }).click();
  await expect(page.getByTestId('form-task')).toHaveText('massnahme');
  await expect(page.getByTestId('form-parent')).toHaveText('gebiet=g1');
  await expect(page.getByTestId('form-geometry')).toHaveText('');
});
