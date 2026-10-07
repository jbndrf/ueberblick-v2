import { devices, expect, test as base, type Page } from '@playwright/test';
import { acceptedBindRuns, areaName, bindToken, seedBindWorld, AREA_NAME } from './bind-world';
import { E2E_PORT } from '../../playwright.config';
import { watchErrors } from './world';

/**
 * WP-828 (verify-later of WP-795 and WP-788). A child task whose form shows a field of the bound parent ("Aus Fläche"):
 * the edited value lands on the parent on the server (v3: a form field of the bound Objekt writes to it in the same run).
 * And: switching the language in Einstellungen while a form is open keeps the form, and Absenden closes it and sends the run.
 * Pixel 7 and Desktop Chrome 1280x800.
 */
const it = base.extend<object, { world: true }>({
  world: [
    async ({ playwright }, use) => {
      await seedBindWorld(playwright, `http://localhost:${E2E_PORT}`);
      await use(true);
    },
    { scope: 'worker' },
  ],
});
it.use({ ...devices['Pixel 7'], locale: 'de-DE' });

async function openTree(page: Page, person: string): Promise<void> {
  await page.goto(`/login?token=${encodeURIComponent(bindToken(person))}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Liste' }).click();
  await page
    .getByRole('button', { name: /^Baum #/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Liste' }).click();
}

for (const [name, screen] of [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const) {
  it.describe(name, () => {
    it.use(screen);
    let problems: string[] = [];
    it.beforeEach(({ page, world }) => {
      void world;
      problems = watchErrors(page);
    });
    it.afterEach(() => {
      expect(problems).toEqual([]);
    });

    it('a bound parent field in the child form: badge "Aus Fläche", edit, submit, the server holds the new value on the parent', async ({
      page,
    }, info) => {
      await openTree(page, `p-bind-${name}-${info.repeatEachIndex}-${info.retry}`);
      await page.getByRole('button', { name: 'Fläche prüfen' }).click();
      const field = page.getByRole('textbox', { name: /^Name/ });
      await expect(field).toBeVisible();
      await expect(page.getByTestId('field-origin')).toBeVisible();
      await expect(page.getByTestId('field-origin')).toContainText('Aus Fläche');
      const before = acceptedBindRuns('flaeche_pruefen');
      const next = `Park ${name} ${info.repeatEachIndex}-${info.retry}`;
      await field.fill(next);
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect(field).toHaveCount(0);
      await expect.poll(() => acceptedBindRuns('flaeche_pruefen')).toBe(before + 1);
      expect(areaName()).toBe(next);
      expect(next).not.toBe(AREA_NAME);
    });

    it('language switched in Einstellungen mid-form: the form stays, relabels, Absenden closes it and the run is sent', async ({
      page,
    }, info) => {
      await openTree(page, `p-lang-${name}-${info.repeatEachIndex}-${info.retry}`);
      await page.getByRole('button', { name: 'Fläche prüfen' }).click();
      await page
        .getByRole('textbox', { name: /^Name/ })
        .fill(`Lang ${name} ${info.repeatEachIndex}-${info.retry}`);
      // Einstellungen opens over the open form on a phone too (v3 stacks it over the detail; WP-829).
      // On a phone the open form sheet covers the bottom bar; the header's account icon opens Einstellungen (v3 UserCircle).
      await page.getByRole('button', { name: name === 'phone' ? 'Konto' : 'Einstellungen' }).click();
      const sheet = page.getByRole('dialog', { name: 'Einstellungen' });
      await sheet.getByRole('tab', { name: 'Optionen' }).click();
      await sheet.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
      const field = page.getByRole('textbox', { name: /^Name/ });
      await expect(field).toHaveValue(/^Lang /); // typed text kept
      const before = acceptedBindRuns('flaeche_pruefen');
      await page.getByRole('button', { name: 'Submit' }).click();
      await expect(field).toHaveCount(0);
      await expect.poll(() => acceptedBindRuns('flaeche_pruefen')).toBe(before + 1);
    });
  });
}
