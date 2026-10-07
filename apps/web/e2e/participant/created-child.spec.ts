import { devices, expect, test, type Page } from '@playwright/test';
import { openProjectDb } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { KEY, seedWorld, signIn, watchErrors } from './world';

/**
 * WP-748: a task that creates a child of the open feature ("Maßnahme anlegen" on a tree, the shape of "Auflage
 * erteilen" on an event) opens the new child, and it stays open after the sync: the id the device planned is the id
 * the server stores (both plan from the run's id).
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
  // one tree in stage "massnahme" (a kontrolle with vitalitaet v3), so "Maßnahme anlegen" is offered
  const field = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await field.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, KEY, 'p-field-748', ['kontrolle']) },
  });
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  const tree = db.prepare<{ id: string }>("SELECT id FROM features WHERE type = 'baum' LIMIT 1").get();
  db.close();
  const r = await field.post(`/api/p/${KEY}/runs`, {
    data: {
      id: '00000000-0000-7000-8000-0000000007a1',
      task: 'kontrolle',
      configVersion: 1,
      featureId: tree?.id,
      input: { vitalitaet: 'v3', befund: 'Pilz am Stamm' },
    },
  });
  expect(r.status(), await r.text()).toBe(200);
  await field.dispose();
});

function measures(): { id: string; baum: string | null }[] {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    return db
      .prepare<{ id: string; baum: string | null }>(
        "SELECT id, json_extract(properties, '$.baum') AS baum FROM features WHERE type = 'massnahme'",
      )
      .all();
  } finally {
    db.close();
  }
}

/** Opens the tree (the only one, in stage Maßnahme, so "Maßnahme anlegen" is offered) through the list. */
async function openMeasureTree(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Liste' }).click();
  await page
    .getByRole('button', { name: /^Baum #/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Liste' }).click();
}

test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
for (const [name, screen] of [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const) {
  test.describe(name, () => {
    test.use(screen);
    let problems: string[] = [];
    test.beforeEach(({ page }) => {
      problems = watchErrors(page);
    });
    test.afterEach(() => {
      expect(problems).toEqual([]);
    });

    test('the new child opens and stays open after the sync', async ({ page }) => {
      await signIn(page);
      const before = measures().length;
      await openMeasureTree(page);
      // the create of a child sits in the relation menu of the sheet (v3), not among the tasks of the row
      await page.getByRole('button', { name: 'Verknüpfte Objekte' }).click();
      await page.getByRole('menuitem', { name: /Maßnahme/ }).click();
      await page.getByRole('button', { name: 'Maßnahme anlegen' }).click();
      await page.getByRole('button', { name: /^Art/ }).click();
      // a phone picks in a sheet of radios (closing itself or with "Fertig"); a desktop picks from a listbox
      const radio = page.getByRole('radio', { name: 'Kronenschnitt' });
      if ((page.viewportSize()?.width ?? 0) < 600) {
        await radio.click();
        const done = page.getByRole('button', { name: 'Fertig' });
        if (await done.isVisible()) await done.click();
      } else await page.getByRole('option', { name: 'Kronenschnitt' }).click();
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => measures().length, { timeout: 20_000 }).toBe(before + 1);
      // the sheet of the new measure is open, and neither now nor after the pull does it say "not on this device"
      await expect(page.getByRole('dialog').getByText('Maßnahme').first()).toBeVisible();
      await page.waitForTimeout(3_000);
      await expect(page.getByText('Dieses Objekt liegt nicht auf diesem Gerät.')).toHaveCount(0);
      await expect(page.getByRole('dialog').getByText('Maßnahme').first()).toBeVisible();
    });
  });
}
