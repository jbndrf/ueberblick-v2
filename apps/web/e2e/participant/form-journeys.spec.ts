import { devices, expect, test, type Page } from '@playwright/test';
import { acceptedRuns, fieldToken, resetTree, seedFormWorld, treeProps } from './form-world';
import { watchErrors } from './world';

/**
 * WP-751: the step-2 form journeys on the built app (real MapLibre), at Pixel 7 and Desktop Chrome 1280x800. Sources in
 * v3: FormRenderer.svelte:28-32, FormFillTool.svelte:70-103 (jump to the first page with an error), :172 and :358-382
 * (the "n fehlen" badge), :445-501 (the "Felder werden geleert" dialog). Owner decisions: Q5 (clear after the warning),
 * Q6 (quick edit is a step of a task).
 */
const it = test.extend<object, { world: true }>({
  world: [
    async ({ playwright }, use) => {
      await seedFormWorld(playwright);
      await use(true);
    },
    { scope: 'worker' },
  ],
});

/** Signs in, opens the one tree through the list and closes the list again, so the sheet shows. */
async function openTree(page: Page): Promise<void> {
  await page.goto(`/login?token=${encodeURIComponent(fieldToken())}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Liste' }).click();
  await page
    .getByRole('button', { name: /^Baum #/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect(page.getByRole('button', { name: 'Prüfung' })).toBeVisible();
}

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 600;

/** Picks an option of a select: a phone picks in a sheet of radios (it may close itself or ask "Fertig"), a desktop from a listbox. */
async function pick(page: Page, field: RegExp, option: string): Promise<void> {
  await page.getByRole('button', { name: field }).click();
  if (isPhone(page)) {
    await page.getByRole('radio', { name: option }).click();
    const done = page.getByRole('button', { name: 'Fertig' });
    if (await done.isVisible()) await done.click();
  } else await page.getByRole('option', { name: option }).click();
}

test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
for (const [name, screen] of [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const) {
  it.describe(name, () => {
    it.use(screen);
    let problems: string[] = [];
    it.beforeEach(async ({ page, world, playwright, baseURL }) => {
      void world;
      await resetTree(playwright, baseURL ?? '');
      problems = watchErrors(page);
    });
    it.afterEach(() => {
      expect(problems).toEqual([]);
    });

    it('a paged task shows "n fehlen" per tab; Absenden with a gap sends nothing and jumps to the first page with an error', async ({
      page,
    }) => {
      await openTree(page);
      const before = acceptedRuns('pruefung');
      await page.getByRole('button', { name: 'Prüfung' }).click();
      const allgemein = page.getByRole('tab', { name: /Allgemein/ });
      const befund = page.getByRole('tab', { name: /Befund/ });
      // v3 counts what is missing only after the first Absenden (FormFillTool.svelte:358-382); Absenden sits on the last page
      await expect(page.getByRole('img', { name: /fehlen auf dieser Seite/ })).toHaveCount(0);
      await befund.click();
      await page.getByRole('button', { name: 'Absenden' }).click();
      // both pages have a gap: the form jumps to the first page with an error, and both tabs say "1 fehlen"
      await expect(allgemein).toHaveAttribute('aria-selected', 'true');
      await expect(allgemein.getByRole('img', { name: '1 fehlen auf dieser Seite' })).toBeVisible();
      await expect(befund.getByRole('img', { name: '1 fehlen auf dieser Seite' })).toBeVisible();
      await expect(page.locator('#ub-field-titel-error')).toBeVisible();
      await page.waitForTimeout(1_000);
      expect(acceptedRuns('pruefung')).toBe(before);
      // fill the second page only: its count goes, and Absenden jumps back to the first page
      await befund.click();
      await page.getByLabel(/^Befund/).fill('Pilz am Stamm');
      await expect(befund.getByRole('img')).toHaveCount(0);
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect(allgemein).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#ub-field-titel-error')).toBeVisible();
      await page.waitForTimeout(1_000);
      expect(acceptedRuns('pruefung')).toBe(before);
      // once the gap is filled it goes through
      await page.getByLabel(/^Titel/).fill('Linde 2');
      await page.getByRole('button', { name: 'Weiter' }).click();
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => acceptedRuns('pruefung'), { timeout: 20_000 }).toBe(before + 1);
    });

    it('a change that hides a stored field asks "Felder werden geleert": Abbrechen sends nothing, confirming sends one run (Q5)', async ({
      page,
    }) => {
      await openTree(page);
      expect(treeProps()['detail']).toBe('Pilz');
      const before = acceptedRuns('bewertung');
      await page.getByRole('button', { name: 'Bewertung' }).click();
      await expect(page.getByLabel(/^Detail/)).toHaveValue('Pilz');
      await pick(page, /^Typ/, 'Typ B');
      await expect(page.getByLabel(/^Detail/)).toHaveCount(0);
      await page.getByRole('button', { name: 'Absenden' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByText('Felder werden geleert')).toBeVisible();
      await expect(dialog.getByText('Detail')).toBeVisible();
      await dialog.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(dialog).toHaveCount(0);
      await page.waitForTimeout(1_000);
      expect(acceptedRuns('bewertung')).toBe(before);
      expect(treeProps()['detail']).toBe('Pilz');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Leeren & speichern' }).click();
      await expect.poll(() => acceptedRuns('bewertung'), { timeout: 20_000 }).toBe(before + 1);
      await expect.poll(() => treeProps()['typ'], { timeout: 20_000 }).toBe('b');
    });

    // D1 (fixed by WP-760): core `formApi.hiddenClears` lets the confirmed explicit null clear the stored hidden field.
    it('after "Leeren & speichern" the hidden field is gone on the server (Q5, D1)', async ({ page }) => {
      await openTree(page);
      await page.getByRole('button', { name: 'Bewertung' }).click();
      await pick(page, /^Typ/, 'Typ B');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Leeren & speichern' }).click();
      await expect.poll(() => treeProps()['typ'], { timeout: 20_000 }).toBe('b');
      expect(treeProps()['detail'] ?? null).toBeNull();
    });

    it('Daten -> Bearbeiten: one run changes one value and empties another (Q6)', async ({ page }) => {
      await openTree(page);
      const before = acceptedRuns('stammdaten');
      await page.getByRole('button', { name: 'Bearbeiten' }).click();
      await page.getByRole('tab', { name: 'Daten' }).click();
      await page.getByLabel(/^Titel/).fill('Eiche');
      await page.getByLabel(/^Notiz/).fill('');
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect.poll(() => acceptedRuns('stammdaten'), { timeout: 20_000 }).toBe(before + 1);
      await page.waitForTimeout(1_000);
      expect(acceptedRuns('stammdaten')).toBe(before + 1);
      await expect.poll(() => treeProps()['titel'], { timeout: 20_000 }).toBe('Eiche');
      expect(treeProps()['notiz'] ?? null).toBeNull();
    });

    it('"Schritt n von m" counts every step, and Zurück keeps the entered values', async ({ page }) => {
      await openTree(page);
      await page.getByRole('button', { name: 'Mehrstufig' }).click();
      await expect(page.getByText('Schritt 1 von 3')).toBeVisible();
      await page.getByLabel(/^Befund/).fill('Entwurf');
      await page.getByRole('button', { name: 'Weiter' }).click();
      await expect(page.getByText('Schritt 2 von 3')).toBeVisible();
      await page.getByLabel(/^Titel/).fill('Neu');
      await page.getByRole('button', { name: 'Weiter' }).click();
      await expect(page.getByText('Schritt 3 von 3')).toBeVisible();
      await page.getByRole('button', { name: 'Zurück' }).click();
      await expect(page.getByText('Schritt 2 von 3')).toBeVisible();
      await expect(page.getByLabel(/^Titel/)).toHaveValue('Neu');
      await page.getByRole('button', { name: 'Zurück' }).click();
      await expect(page.getByText('Schritt 1 von 3')).toBeVisible();
      await expect(page.getByLabel(/^Befund/)).toHaveValue('Entwurf');
    });

    it('a select opens full screen on the phone and as a listbox on desktop', async ({ page }) => {
      await openTree(page);
      await page.getByRole('button', { name: 'Bewertung' }).click();
      await page.getByRole('button', { name: /^Typ/ }).click();
      const view = page.viewportSize();
      if (view === null) throw new Error('no viewport');
      if (isPhone(page)) {
        const sheet = page.getByRole('dialog').filter({ has: page.getByRole('radio', { name: 'Typ B' }) });
        await expect(sheet).toBeVisible();
        const box = await sheet.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(view.width - 2);
        // v3's dialog: full width, 80% of the visual viewport (multi-select.svelte:308), over a backdrop that covers the page
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(view.height * 0.75);
      } else {
        await expect(page.getByRole('listbox')).toBeVisible();
        await expect(page.getByRole('option', { name: 'Typ B' })).toBeVisible();
        const box = await page.getByRole('listbox').boundingBox();
        expect(box?.width ?? 0).toBeLessThan(view.width / 2);
        await expect(page.getByRole('radio')).toHaveCount(0);
      }
    });
  });
}
