/**
 * Two devices of one project (WP-944): two browser contexts, each its own empty device (own IndexedDB, own session),
 * both signed in with a fresh QR token and both on `/map`. Use it for any journey where one participant's change must
 * show on another device. It reaches features through the list alternative and the feature sheet, never through view chips.
 */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mapToken } from './map-world';
import { MAP_PROJECT, qrLink, serverRuns } from './world';

export interface Device {
  readonly context: BrowserContext;
  readonly page: Page;
}

/**
 * A fresh device: new context, signed in, on the app shell. It uses the project `karte`, so the runs a test submits
 * never reach the counts `participant.spec.ts` reads from the project `musterstadt`; `restoreFinding` undoes the
 * change for `map.spec.ts`, which searches for the seeded finding.
 */
export async function openDevice(browser: Browser, baseURL: string): Promise<Device> {
  const context = await browser.newContext({ baseURL, locale: 'en-US' });
  const page = await context.newPage();
  await page.goto(qrLink(mapToken()));
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole('banner')).toBeVisible();
  return { context, page };
}

/** Opens the seeded tree's feature sheet from the list and returns the sheet. The first pull must have delivered it. */
export async function openTreeSheet(page: Page) {
  const toggle = page.getByRole('button', { name: 'List', exact: true });
  // the device may still be opening (the banner shows before the map screen): wait for the toggle or the table, else a
  // count of 0 only means "not yet" and the list is never opened
  await expect(toggle.or(page.getByRole('table'))).toBeVisible({ timeout: 30_000 });
  if ((await toggle.count()) > 0) await toggle.click();
  const row = page.getByRole('table').getByRole('cell').first().getByRole('button');
  await expect(row).toBeVisible({ timeout: 30_000 });
  const name = (await row.innerText()).trim();
  await row.click();
  const sheet = page.getByRole('dialog', { name });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('tab', { name: 'Data' }).click(); // v3: the sheet opens on Activity; the values are on Data
  return sheet;
}

/**
 * Runs the task "Add finding" from an open feature sheet (the device is online): the form closes back to the feature
 * sheet (v3's form, WP-624) and the server has recorded the run, which the test reads from the project database.
 */
export async function submitFinding(page: Page, text: string): Promise<void> {
  const sent = (): number => serverRuns('befund_ergaenzen', MAP_PROJECT).length;
  const before = sent();
  await page.getByRole('button', { name: 'Add finding' }).click();
  await page.getByRole('textbox', { name: 'Finding' }).fill(text);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('textbox', { name: 'Finding' })).toBeHidden();
  await expect.poll(sent, { timeout: 30_000 }).toBe(before + 1);
}

/** Milliseconds until `check` first holds, polling fast; throws when `limitMs` passes. */
export async function latencyUntil(check: () => Promise<boolean>, limitMs: number): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (await check().catch(() => false)) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`not seen within ${limitMs} ms`);
}

/** Sets the finding back to `text` and waits until the server has accepted it, so later specs see the seeded world. A change must differ from the current finding. */
export async function restoreFinding(page: Page, text: string): Promise<void> {
  // the sheets of the earlier submit are modal and keep a backdrop: start the app afresh
  await page.reload();
  await expect(page.getByRole('banner')).toBeVisible();
  await openTreeSheet(page);
  await submitFinding(page, text);
}
