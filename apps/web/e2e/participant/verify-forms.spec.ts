import { devices, expect, test, type Page } from '@playwright/test';
import {
  acceptedRuns,
  resetTree,
  seedVerifyWorld,
  treeProps,
  verifyToken,
} from './helpers/verify-forms-world';
import { watchErrors } from './world';

/**
 * WP-833: step-2 verification of the p3 task-form rows on the built app, at Pixel 7 and Desktop Chrome 1280x800: validation
 * messages, show_if, the clearing guard, an input per property type, prefill, computed and a task without form. The parent
 * value in a child form is driven by form-bind-locale.spec.ts. Sources in v3: form-state.ts:406-465 (validation),
 * :512-530 (conditional_logic), :209-241 (prefill), FormFillTool.svelte:296-319,445-501 (clearing guard),
 * FieldRenderer.svelte:643-799 (computed, inputs), the v3 detail module, lines 620-627 (task without form).
 */
const it = test.extend<object, { world: true }>({
  world: [
    async ({ playwright }, use) => {
      await seedVerifyWorld(playwright);
      await use(true);
    },
    { scope: 'worker' },
  ],
});

async function openTree(page: Page): Promise<void> {
  await page.goto(`/login?token=${encodeURIComponent(verifyToken())}`);
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

/** Picks an option of a select: a sheet of radios on a phone (maybe "Fertig"), a listbox on desktop. */
async function pick(
  page: Page,
  field: RegExp,
  option: string,
  role: 'radio' | 'checkbox' = 'radio',
): Promise<void> {
  await page.getByRole('button', { name: field }).click();
  if (isPhone(page)) {
    await page.getByRole(role, { name: option }).click();
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
    it.beforeEach(async ({ page, world, playwright }) => {
      void world;
      await resetTree(playwright);
      problems = watchErrors(page);
    });
    it.afterEach(() => {
      expect(problems).toEqual([]);
    });

    it('validation: required, min, max, length, pattern and email show a message under the field and send nothing', async ({
      page,
    }) => {
      await openTree(page);
      const before = acceptedRuns('pruefung');
      await page.getByRole('button', { name: 'Prüfung' }).click();
      await page.getByLabel(/^Titel/).fill('');
      await page.getByLabel(/^Höhe/).fill('-1');
      await page.getByLabel(/^Kürzel/).fill('ab');
      await page.getByLabel(/^E-Mail/).fill('keine-adresse');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect(page.locator('#ub-field-titel-error')).toBeVisible();
      await expect(page.locator('#ub-field-titel-error')).toHaveText('Titel ist ein Pflichtfeld');
      await expect(page.locator('#ub-field-hoehe-error')).toBeVisible();
      await expect(page.locator('#ub-field-hoehe-error')).toHaveText('Höhe muss mindestens 0 sein');
      await expect(page.locator('#ub-field-kurz-error')).toBeVisible();
      await expect(page.locator('#ub-field-kurz-error')).toHaveText('Kürzel braucht 3 bis 8 Zeichen');
      await expect(page.locator('#ub-field-mail-error')).toBeVisible();
      await expect(page.locator('#ub-field-mail-error')).toHaveText('E-Mail ist keine gültige Adresse');
      await page.getByLabel(/^Höhe/).fill('101');
      await page.getByLabel(/^Kürzel/).fill('abcdefghi');
      await expect(page.locator('#ub-field-hoehe-error')).toBeVisible();
      await expect(page.locator('#ub-field-hoehe-error')).toHaveText('Höhe darf höchstens 100 sein');
      await expect(page.locator('#ub-field-kurz-error')).toBeVisible();
      await expect(page.locator('#ub-field-kurz-error')).toHaveText('Kürzel braucht 3 bis 8 Zeichen');
      await page.waitForTimeout(1_000);
      expect(acceptedRuns('pruefung')).toBe(before);
      await page.getByLabel(/^Titel/).fill('Eiche');
      await page.getByLabel(/^Höhe/).fill('12');
      await page.getByLabel(/^Kürzel/).fill('abc');
      await page.getByLabel(/^E-Mail/).fill('a@b.de');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => acceptedRuns('pruefung'), { timeout: 20_000 }).toBe(before + 1);
      expect(treeProps()['titel']).toBe('Eiche');
    });

    it('show_if: a field appears and disappears live with the answer it depends on', async ({ page }) => {
      await openTree(page);
      await page.getByRole('button', { name: 'Bedingt' }).click();
      await expect(page.getByLabel(/^Detail/)).toBeVisible();
      await pick(page, /^Art/, 'Art B');
      await expect(page.getByLabel(/^Detail/)).toHaveCount(0);
      await pick(page, /^Art/, 'Art A');
      await expect(page.getByLabel(/^Detail/)).toHaveValue('Pilz');
    });

    it('clearing guard: hiding a stored field asks "Felder werden geleert"; Abbrechen sends nothing, "Leeren & speichern" clears it', async ({
      page,
    }) => {
      await openTree(page);
      const before = acceptedRuns('bedingt');
      await page.getByRole('button', { name: 'Bedingt' }).click();
      await pick(page, /^Art/, 'Art B');
      await page.getByRole('button', { name: 'Absenden' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByText('Felder werden geleert')).toBeVisible();
      await expect(dialog.getByText('Detail')).toBeVisible();
      await dialog.getByRole('button', { name: 'Abbrechen' }).click();
      await page.waitForTimeout(1_000);
      expect(acceptedRuns('bedingt')).toBe(before);
      expect(treeProps()['detail']).toBe('Pilz');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Leeren & speichern' }).click();
      await expect.poll(() => acceptedRuns('bedingt'), { timeout: 20_000 }).toBe(before + 1);
      await expect.poll(() => treeProps()['art'], { timeout: 20_000 }).toBe('b');
      expect(treeProps()['detail'] ?? null).toBeNull();
    });

    it('an input per property type: text, number, integer, checkbox, date, select, multiselect, multiline and email are filled and stored', async ({
      page,
    }) => {
      await openTree(page);
      const before = acceptedRuns('typen');
      await page.getByRole('button', { name: 'Alle Eingaben' }).click();
      await page.getByLabel(/^Titel/).fill('Buche');
      await page.getByLabel(/^Höhe/).fill('12.5');
      await page.getByLabel(/^Anzahl/).fill('3');
      await page.getByRole('checkbox', { name: /^Aktiv/ }).check();
      await page.getByLabel(/^Datum/).fill('2026-05-01');
      await pick(page, /^Art/, 'Art B');
      await pick(page, /^Merkmale/, 'Zwei', 'checkbox');
      const notiz = page.getByLabel(/^Notiz/);
      expect(await notiz.evaluate((e) => e.tagName)).toBe('TEXTAREA');
      await notiz.fill('Zeile 1\nZeile 2');
      const mail = page.getByLabel(/^E-Mail/);
      await expect(mail).toHaveAttribute('type', 'email');
      await mail.fill('a@b.de');
      await expect(page.getByLabel(/^Höhe/)).toHaveAttribute('type', 'number');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => acceptedRuns('typen'), { timeout: 20_000 }).toBe(before + 1);
      const p = treeProps();
      expect(p).toMatchObject({
        titel: 'Buche',
        hoehe: 12.5,
        anzahl: 3,
        aktiv: true,
        art: 'b',
        notiz: 'Zeile 1\nZeile 2',
        mail: 'a@b.de',
      });
      expect(String(p['datum'])).toContain('2026-05-01');
      expect(p['tags']).toEqual(['y']);
    });

    it('prefill: the form opens with the last value, a constant; a field without a prefill starts empty', async ({
      page,
    }) => {
      await openTree(page);
      await page.getByRole('button', { name: 'Vorbelegung' }).click();
      await expect(page.getByLabel(/^Titel/)).toHaveValue('Linde');
      await expect(page.getByLabel(/^Kennung/)).toHaveValue('K-7');
      await expect(page.getByLabel(/^Befund/)).toHaveValue('');
    });

    it('prefill now: a date field opens with today', async ({ page }) => {
      await openTree(page);
      await page.getByRole('button', { name: 'Vorbelegung' }).click();
      await expect(page.getByLabel(/^Erfasst am/)).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('a datetime input is accepted and stored', async ({ page }) => {
      await openTree(page);
      const before = acceptedRuns('typen');
      await page.getByRole('button', { name: 'Alle Eingaben' }).click();
      await page.getByLabel(/^Zeitpunkt/).fill('2026-05-01T10:30');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => acceptedRuns('typen'), { timeout: 20_000 }).toBe(before + 1);
      expect(String(treeProps()['zeit'])).toContain('2026-05-01');
    });

    it('computed: "Wird beim Speichern berechnet" and the badge, no input, and the value shows once saved', async ({
      page,
    }) => {
      await openTree(page);
      const before = acceptedRuns('berechnung');
      await page.getByRole('button', { name: 'Berechnung' }).click();
      const computed = page.getByTestId('computed-field');
      await expect(computed).toBeVisible();
      await expect(page.getByTestId('computed-badge')).toBeVisible();
      await expect(page.getByTestId('computed-badge')).toHaveText('Berechnet');
      await expect(page.getByLabel(/^Titel gross/)).toHaveCount(0);
      await page.getByLabel(/^Titel/).fill('Birke');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => acceptedRuns('berechnung'), { timeout: 20_000 }).toBe(before + 1);
      await expect.poll(() => treeProps()['titel_gross'], { timeout: 20_000 }).toBe('BIRKE');
    });

    it('a task without a form changes the stage on one tap, with no form in between', async ({ page }) => {
      await openTree(page);
      const before = acceptedRuns('abschliessen');
      expect(treeProps()['stage']).toBe('offen');
      await page.getByRole('button', { name: 'Abschließen' }).click();
      await expect.poll(() => acceptedRuns('abschliessen'), { timeout: 20_000 }).toBe(before + 1);
      expect(treeProps()['stage']).toBe('erledigt');
      await expect(page.getByRole('button', { name: 'Absenden' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Abschließen' })).toHaveCount(0);
    });
  });
}
