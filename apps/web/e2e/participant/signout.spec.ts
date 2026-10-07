import { devices, expect, test, type Page } from '@playwright/test';
import { fieldToken, seedWorld, signIn, watchErrors } from './world';

/**
 * WP-727 (QA hunt 3): signing out lands on the sign-in page and logs no console error. The session is gone, so nothing
 * may ask the server for the bootstrap again (that answer is a 401, which the browser logs as an error).
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

for (const size of ['phone', 'desktop'] as const) {
  test.describe(size, () => {
    if (size === 'desktop')
      test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
    test('sign out: the sign-in page, no console error and no bootstrap request after the logout', async ({
      page,
    }) => {
      const problems = watchErrors(page);
      const requests: string[] = [];
      page.on('request', (r) => requests.push(new URL(r.url()).pathname));
      await signIn(page);
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('tab', { name: 'Profil' }).click();
      const before = requests.filter((p) => p === '/participant-api/bootstrap').length;
      await page.getByRole('button', { name: 'Abmelden' }).click();
      const confirm = page.getByRole('alertdialog');
      if (await confirm.isVisible().catch(() => false))
        await confirm.getByRole('button', { name: 'Abmelden' }).click();
      await expect(page).toHaveURL(/\/login/);
      await page.waitForTimeout(1500);
      expect(requests.filter((p) => p === '/participant-api/bootstrap').length).toBe(before);
      expect(problems).toEqual([]);
    });
  });
}

test('signed out, /map reaches /login with no failing request and no console error (WP-731)', async ({
  page,
}) => {
  const problems = watchErrors(page);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.goto('/map');
  await expect(page).toHaveURL(/\/login/);
  await page.waitForTimeout(1000);
  expect(requests).not.toContain('/participant-api/bootstrap');
  expect(problems).toEqual([]);
});

/** WP-769 (device privacy hunt): Abmelden clears the participant's local copy, as v3's resetAllParticipantState did. */
const localCopy = (page: Page) =>
  page.evaluate(async (project) => {
    const dbs = (await indexedDB.databases()).map((d) => d.name ?? '').filter((n) => n.includes(project));
    const keys = Object.keys(localStorage).filter((k) => k.includes(project));
    return { dbs, keys };
  }, 'journeystadt');

test('Abmelden leaves no database, key or draft of the participant on the device (WP-769)', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await signIn(page);
  await page.evaluate(() => localStorage.setItem('ub:draft:journeystadt:p-field:t1', '{}'));
  await expect.poll(async () => (await localCopy(page)).dbs.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('tab', { name: 'Profil' }).click();
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await localCopy(page)).toEqual({ dbs: [], keys: [] });
  expect(await page.evaluate(() => localStorage.getItem('ub:bootstrap'))).toBeNull();
  expect(problems).toEqual([]);
});

/** WP-782: Abmelden also removes the participant's offline map packs (OPFS); another person's packs stay. */
const seedPack = (page: Page, participant: string) =>
  page.evaluate(async (who) => {
    const root = await navigator.storage.getDirectory();
    let dir = await root.getDirectoryHandle('packs', { create: true });
    dir = await dir.getDirectoryHandle('p-journeystadt', { create: true });
    dir = await dir.getDirectoryHandle(`u-${who}`, { create: true });
    const file = await dir.getFileHandle('index.json', { create: true });
    const w = await file.createWritable();
    await w.write('{}');
    await w.close();
  }, participant);
const packScopes = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      const dir = await (await root.getDirectoryHandle('packs')).getDirectoryHandle('p-journeystadt');
      const names: string[] = [];
      for await (const [name] of (
        dir as unknown as { entries(): AsyncIterable<[string, unknown]> }
      ).entries())
        names.push(name);
      return names.sort();
    } catch {
      return [];
    }
  });

for (const size of ['phone', 'desktop'] as const) {
  test.describe(`packs ${size}`, () => {
    if (size === 'desktop')
      test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
    test("Abmelden removes the participant pack directory and keeps another person's (WP-782)", async ({
      page,
    }) => {
      const problems = watchErrors(page);
      await signIn(page);
      await seedPack(page, 'p-field');
      await seedPack(page, 'someone-else');
      expect(await packScopes(page)).toEqual(['u-p-field', 'u-someone-else']);
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('tab', { name: 'Profil' }).click();
      await page.getByRole('button', { name: 'Abmelden' }).click();
      await expect(page).toHaveURL(/\/login/);
      expect(await packScopes(page)).toEqual(['u-someone-else']);
      expect(problems).toEqual([]);
    });
  });
}

test('Abmelden offline says so and keeps the session and the local copy (WP-769)', async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('tab', { name: 'Profil' }).click();
  const before = await localCopy(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByTestId('signout-offline')).toBeVisible();
  await expect(page.getByTestId('signout-offline')).toContainText('keine Verbindung');
  await expect(page).toHaveURL(/\/map$/);
  expect(await localCopy(page)).toEqual(before);
  await context.setOffline(false);
});

test('after sign-in localStorage holds no login token (WP-772)', async ({ page }) => {
  const token = fieldToken();
  await page.goto(`/login?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/map/);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).toContain('ub:bootstrap');
  expect(stored).not.toContain(token);
});
