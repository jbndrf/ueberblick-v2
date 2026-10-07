// WP-643: the task form in the shared detail shell at phone 390x844 and desktop 1280x800: v3's footer (Abbrechen, Weiter,
// Absenden with icons), the submitting state, half-width columns, email, sticky footer, no axe violations.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { axeViolations } from '../../../../../e2e/a11y/axe';

const shell = (page: Page): Locator => page.getByTestId('form-shell');
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

test('the form is in the shell: full height on a phone, the 450 px panel on a desktop', async ({
  page,
}, info) => {
  await open(page);
  const vp = page.viewportSize();
  if (vp === null) throw new Error('no viewport');
  const b = await box(shell(page));
  if (info.project.name === 'phone') {
    expect(b.width).toBe(vp.width);
    expect(Math.abs(b.height - vp.height * 0.9)).toBeLessThan(2);
    // the header tap toggles to the 35 vh peek
    await page.getByRole('button', { name: 'Größe ändern' }).click();
    await page.waitForTimeout(350);
    expect(Math.abs((await box(shell(page))).height - vp.height * 0.35)).toBeLessThan(2);
  } else {
    expect(b.width).toBe(450);
    expect(b.x + b.width).toBe(vp.width);
  }
  await expect(shell(page).getByRole('heading', { level: 3 })).toHaveText('Baum');
});

test('one shell only: the form is the only dialog on the page', async ({ page }) => {
  await open(page);
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
});

test('half-width columns sit side by side, also on a phone; others are full width', async ({ page }) => {
  await open(page);
  const left = await box(page.getByLabel(/Höhe/).locator('xpath=ancestor::*[@data-column][1]'));
  const right = await box(page.getByLabel(/Breite/).locator('xpath=ancestor::*[@data-column][1]'));
  const full = await box(page.getByLabel(/Art/).locator('xpath=ancestor::*[@data-column][1]'));
  expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  expect(left.x + left.width).toBeLessThan(right.x);
  expect(Math.abs(left.width - right.width)).toBeLessThan(2);
  expect(left.width).toBeLessThan(full.width * 0.55);
  expect(left.width).toBeGreaterThan(full.width * 0.4);
});

test('email is type=email', async ({ page }) => {
  await open(page);
  await expect(page.getByLabel(/E-Mail/)).toHaveAttribute('type', 'email');
});

test('the placeholder shows in an empty input; the page title is the tab and the heading, the description under it', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByLabel(/Art/)).toHaveAttribute('placeholder', 'z. B. Linde');
  await expect(page.getByRole('tab', { name: 'Seite 1' })).toBeVisible();
  await expect(shell(page).getByRole('heading', { level: 4 })).toHaveCount(0);
  await page.getByRole('tab', { name: /Befund/ }).click();
  await expect(shell(page).getByRole('heading', { level: 4, name: 'Befund' })).toBeVisible();
  await expect(shell(page).getByText('Bitte beschreiben.')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  const violations = await axeViolations(page);
  expect(violations).toEqual([]);
});

test('footer: Abbrechen on the first page, Weiter with its icon; Absenden with Send on the last page', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
  const next = page.getByRole('button', { name: 'Weiter' });
  await expect(next.locator('svg.lucide-chevron-right')).toHaveCount(1);
  await next.click();
  await expect(page.getByRole('button', { name: 'Zurück' }).locator('svg.lucide-chevron-left')).toHaveCount(
    1,
  );
  await expect(page.getByRole('button', { name: 'Absenden' }).locator('svg.lucide-send')).toHaveCount(1);
});

test('the footer sticks to the bottom edge of the shell, also for a short form', async ({ page }) => {
  await open(page, '?short=1');
  const footer = await box(page.getByTestId('form-footer'));
  const s = await box(shell(page));
  expect(Math.abs(footer.y + footer.height - (s.y + s.height))).toBeLessThan(2);
});

test('the footer stays in view when a long form scrolls', async ({ page }) => {
  await open(page);
  await page.getByLabel(/Art/).fill('Eiche');
  const footer = page.getByTestId('form-footer');
  await expect(footer).toBeInViewport();
});

test('submitting: a spinner and "Wird gesendet…", every button disabled, then the sent screen', async ({
  page,
}) => {
  await open(page, '?short=1&slow=1');
  await page.getByLabel(/Art/).fill('Eiche');
  await page.getByRole('button', { name: 'Absenden' }).click();
  const busy = page.getByRole('button', { name: /Wird gesendet/ });
  await expect(busy).toBeDisabled();
  await expect(busy.locator('svg.animate-spin')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  await expect(page.getByText('Gespeichert. Wird jetzt gesendet.')).toBeVisible();
  expect(JSON.parse((await page.getByTestId('runs').textContent()) ?? '[]')).toHaveLength(1);
});

test('Abbrechen closes the shell with a slide-out', async ({ page }) => {
  await open(page, '?short=1');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('closed')).toHaveText('closed');
  await expect(shell(page)).toHaveAttribute('data-open', 'false');
});

test('no axe violations, and no horizontal scroll', async ({ page }) => {
  await open(page);
  const violations = await axeViolations(page);
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
