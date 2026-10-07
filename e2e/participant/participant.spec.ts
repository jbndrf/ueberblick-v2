import { expect, test, type Page } from '@playwright/test';
import { issueToken, qrLink, seedWorld, serverRuns, setRoles } from './world';

/**
 * WP-550: the participant app in a real browser against the built process. Each test signs in with a fresh QR token in
 * a fresh browser context (an empty device), so what it sees is what the server sent and what it queued itself.
 * The list alternative of the map is used to reach a feature: it is the keyboard and screen-reader path, and it does not
 * depend on the GPU of the machine that runs the tests.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

async function signIn(page: Page): Promise<void> {
  await page.goto(qrLink(issueToken()));
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole('banner')).toBeVisible();
}

async function openTree(page: Page): Promise<string> {
  // the list is the keyboard and screen-reader way to a feature; it does not depend on the GPU of the test machine
  const toggle = page.getByRole('button', { name: 'List', exact: true });
  const row = page.getByRole('table').getByRole('cell').first().getByRole('button');
  // The map mounts once the offline packs are read, so the toggle may come after the header (WP-797): wait for the
  // toggle or the list (a map that cannot draw shows the list at once), never test for the toggle's presence right now.
  await expect(toggle.or(row)).toBeVisible();
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(row).toBeVisible(); // the first pull has delivered the tree
  // WP-593 / B-014: the tree has no required text property (a finding is not a name), so the row shows the type and a
  // short id, never the whole id or a finding; the sheet header shows the same name
  await expect(row).toHaveText(/^Tree #\S{4}$/);
  const name = (await row.innerText()).trim();
  await row.click();
  await expect(page.getByRole('dialog', { name })).toBeVisible();
  return name;
}

async function submitFinding(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Add finding' }).click();
  await page.getByRole('textbox', { name: 'Finding' }).fill(text);
  await page.getByRole('button', { name: 'Submit' }).click();
}

test('the QR link signs in, lands on the map, and the token works on a second device', async ({
  page,
  browser,
  baseURL,
}) => {
  const token = issueToken();
  // WP-599: a fresh device draws its layers with no map error (a layer before its source logged `source ... not found`)
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(qrLink(token));
  await expect(page).toHaveURL(/\/map$/);
  // v3's header names the project; the role "kontrolle" has the search tool, so the desktop header offers Werkzeuge
  await expect(page.getByRole('banner')).toContainText('musterstadt');
  await expect(page.getByRole('banner').getByRole('button', { name: 'Tools' })).toBeVisible();
  // a config compile accepted has no faults to say
  await expect(page.getByTestId('problems')).not.toContainText('tool_setting_invalid');
  await expect(page.getByTestId('problems')).not.toContainText('style_unresolved');
  expect(errors.filter((e) => /source|layers\./.test(e))).toEqual([]);

  // WP-606: the token is reusable, so the same link signs in on another device as well
  const other = await browser.newContext({ baseURL: baseURL ?? '' });
  const again = await other.newPage();
  await again.goto(qrLink(token));
  await expect(again).toHaveURL(/\/map$/);
  await other.close();
});

test('without a session the app sends the visitor to the sign-in page', async ({ page }) => {
  await page.goto('/map');
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.goto('/app'))?.status()).toBe(404); // the first-build shell is gone
});

test('the list opens the feature sheet with its properties and the tasks the role may run', async ({
  page,
}) => {
  await signIn(page);
  const name = await openTree(page);
  const sheet = page.getByRole('dialog', { name });
  await sheet.getByRole('tab', { name: 'Data' }).click(); // v3: the sheet opens on Activity
  await expect(sheet).toContainText('Vitality');
  await expect(sheet.getByRole('button', { name: 'Add finding' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Perform inspection' })).toHaveCount(0); // needs an area
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('offline, a task is saved on the device; when the network is back it is sent', async ({
  page,
  context,
}) => {
  await signIn(page);
  await openTree(page);
  await context.setOffline(true);
  const before = serverRuns('befund_ergaenzen').length; // the server keeps runs of earlier repeats

  await submitFinding(page, 'Riss im Stamm');
  // the form closes back to the feature sheet; the run waits on the device and the server has not got it
  await expect(page.getByRole('textbox', { name: 'Finding' })).toBeHidden();
  expect(serverRuns('befund_ergaenzen')).toHaveLength(before);

  await context.setOffline(false);
  await expect
    .poll(
      () =>
        serverRuns('befund_ergaenzen')
          .slice(before)
          .map((r) => r.outcome),
      { timeout: 30_000 },
    )
    .toEqual(['accepted']);
});

test('a run the server refuses is recorded with its typed reason', async ({ page, context }) => {
  await signIn(page);
  await openTree(page);
  await context.setOffline(true);
  const before = serverRuns('befund_ergaenzen').length;
  await submitFinding(page, 'Zweiter Befund');
  await expect(page.getByRole('textbox', { name: 'Finding' })).toBeHidden();
  // while offline the role changed on the server: the task is no longer available to this participant
  setRoles(['verwaltung']);
  await context.setOffline(false);

  // the refusal is the server's, with its typed reason; where the participant reads it returns with the settings sheet
  // (pending and refused runs, WP-626): v3's form closes back to the feature sheet and shows no outcome of its own
  await expect
    .poll(
      () =>
        serverRuns('befund_ergaenzen')
          .slice(before)
          .map((r) => r.outcome),
      { timeout: 30_000 },
    )
    .toContain('rejected');
  expect(
    serverRuns('befund_ergaenzen')
      .slice(before)
      .find((r) => r.outcome === 'rejected')?.refusal_code,
  ).toMatch(/^(not_available|not_permitted|forbidden|permission_denied)$/);
  setRoles(['kontrolle']);
});
