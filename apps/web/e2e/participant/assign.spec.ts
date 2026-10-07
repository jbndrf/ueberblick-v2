import { devices, expect, test } from '@playwright/test';
import { importParticipant, openProjectDb } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { KEY, seedWorld, watchErrors } from './world';

/**
 * WP-725: "Zuweisen" offers the participants of the project by name (v3 selectable-entities, `select.all`), and the
 * server stores the id of the one chosen. The office (role verwaltung) assigns a tree to a named participant of the
 * Bauhof; a field participant (role kontrolle, not in `select.all`) is not offered anyone else.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
const SCREENS = [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    // one assignee per size: both sizes share this DB, so a shared id would let the second poll pass on the first's data
    for (const [size] of SCREENS)
      importParticipant(
        { db, now: () => new Date() },
        { id: `p-bauhof-${size}`, name: `Bernd Bauhof ${size}`, roles: ['bauhof'] },
      );
  } finally {
    db.close();
  }
});

for (const [name, screen] of SCREENS) {
  test.describe(name, () => {
    test.use(screen);
    let problems: string[] = [];
    test.beforeEach(({ page }) => {
      problems = watchErrors(page);
    });
    test.afterEach(() => {
      expect(problems).toEqual([]);
    });

    function zustaendigOfTrees(): (string | null)[] {
      const db = openProjectDb(E2E_DATA_DIR, KEY);
      try {
        return db
          .prepare<{ z: string | null }>(
            "SELECT json_extract(properties, '$.zustaendig') AS z FROM features WHERE type = 'baum'",
          )
          .all()
          .map((r) => r.z);
      } finally {
        db.close();
      }
    }

    test('the office assigns a tree to a participant by name; the server stores the id', async ({ page }) => {
      await page.goto(
        `/login?token=${encodeURIComponent(rosterToken(E2E_DATA_DIR, KEY, 'p-office', ['verwaltung']))}`,
      );
      await expect(page).toHaveURL(/\/map$/);
      await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole('button', { name: 'Liste' }).click();
      await page
        .getByRole('button', { name: /^Baum #/ })
        .first()
        .click();
      await page.getByRole('button', { name: 'Liste' }).click();
      await page.getByRole('button', { name: 'Zuweisen' }).click();
      await page.getByRole('button', { name: /^Zuständig/ }).click();
      // a phone picks from a sheet of radios, a desktop from a listbox of options (v3 select field)
      const names = page.getByRole((page.viewportSize()?.width ?? 0) < 600 ? 'radio' : 'option');
      await expect(names.filter({ hasText: `Bernd Bauhof ${name}` })).toBeVisible();
      await expect(page.getByText('p-bauhof-')).toHaveCount(0); // the id is never shown as a name
      await names.filter({ hasText: `Bernd Bauhof ${name}` }).click();
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(zustaendigOfTrees, { timeout: 20_000 }).toContain(`p-bauhof-${name}`);
    });
  });
}
