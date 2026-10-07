import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-380: v3's form editor (FormEditorView, the two palettes, FieldCard, FormPreview) in the Objektart's builder, at
 * desktop (mouse: palettes, drag from the grip and from a tile) and phone size (touch: taps, the card's bar):
 * add a new and a library field, reorder, a page break with a title, width, Speichern, reload.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/formstadt/types/baum/builder';

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'formstadt', 'Form Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'formdeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'formdeploy@example.org', 'formstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'formdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/formstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `form${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'formstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const order = (page: Page): Promise<string[]> =>
  page
    .getByTestId('field-card')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['key'] ?? ''));

/** A pointer drag with the mouse: press at the source, move past the threshold, wait for the zone, release on it. */
async function dragTo(page: Page, source: Locator, zone: string): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  if (from === null) throw new Error('source has no box');
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y - 12, { steps: 4 });
  const target = page.getByTestId(zone);
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const to = await target.boundingBox();
  if (to === null) throw new Error('zone has no box');
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
}

const SIZES = [
  {
    name: 'desktop',
    viewport: { width: 1280, height: 800 },
    task: 'kontrolle',
    formTask: 'verschieben',
    touch: false,
  },
  {
    name: 'phone',
    viewport: { width: 390, height: 844 },
    task: 'befund_ergaenzen',
    formTask: 'zuweisen',
    touch: true,
  },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: size.touch });

    test('journey: add a new and a library field, reorder, page break with a title, width, Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const press = async (target: Locator): Promise<void> => (size.touch ? target.tap() : target.click());
      // The card's bar shows on hover, on the selected card and on a touch screen: hover first, as a mouse user does.
      const bar = async (key: string, id: string): Promise<Locator> => {
        const card = page.locator(`[data-key="${key}"]`);
        if (!size.touch) await card.hover();
        return card.getByTestId(id);
      };
      const openEditor = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator(`[data-path="tasks.${size.task}"]`).click();
        const pane = page.getByTestId('task-pane');
        await pane.getByTestId('tab-form').click();
        // Formular: "Felder bearbeiten" opens the editor in place of the task pane (v3: the Werkzeuge tab)
        await pane.getByTestId('step-0-edit').click();
        await expect(page.getByTestId('form-editor')).toBeVisible();
      };
      await openEditor();
      const editor = page.getByTestId('form-editor');
      const before = await order(page);
      expect(before.length).toBeGreaterThan(0);

      // Feldtypen: a tile adds a new field of that type at the end of the page
      await press(editor.getByTestId('tile-dropdown'));
      await expect(page.getByTestId('field-card')).toHaveCount(before.length + 1);
      expect((await order(page)).at(-1)).toMatch(/^neues_feld/);
      const created = (await order(page)).at(-1) ?? '';

      // Feldbibliothek: an existing property of the Objektart
      await press(editor.getByTestId('library-art'));
      await expect(page.getByTestId('field-card')).toHaveCount(before.length + 2);
      expect((await order(page)).at(-1)).toBe('art');

      // The preview draws the participant's own input in the card: the new field is labelled "Neues Feld"
      await expect(page.locator(`[data-key="${created}"]`).getByTestId('card-label')).toContainText(
        'Neues Feld',
      );

      // Reorder: the up and down buttons (the way on a phone and for the keyboard)
      await press(await bar('art', 'field-up'));
      expect((await order(page)).slice(-2)).toEqual(['art', created]);

      if (!size.touch) {
        // Reorder by drag from the grip to the zone before the first line
        await dragTo(page, page.locator(`[data-key="${created}"]`).getByTestId('field-grip'), 'zone-0-full');
        expect((await order(page))[0]).toBe(created);
        // A tile dropped between lines: a new field at that place
        await dragTo(page, editor.getByTestId('tile-date'), 'zone-1-full');
        await expect(page.getByTestId('field-card')).toHaveCount(before.length + 3);
        expect((await order(page))[1]).toMatch(/^neues_feld/);
      }

      // A page break on the last field, and a title for the new page
      const last = (await order(page)).at(-1) ?? '';
      await press(await bar(last, 'field-page'));
      await expect(page.getByTestId('page-tab-1')).toBeVisible();
      await press(page.getByTestId('page-select-1'));
      await press(page.getByTestId('page-rename'));
      await page.getByTestId('page-title-input').fill('Nachtrag');
      await page.getByTestId('page-title-input').press('Enter');
      await expect(page.getByTestId('page-select-1')).toHaveText('Nachtrag');
      await expect(page.getByTestId('form-error')).toHaveCount(0);

      // Width: half width on the last field; its card says so
      await press(await bar(last, 'field-width-left'));
      await expect(page.locator(`[data-key="${last}"]`)).toHaveAttribute('data-column', 'left');

      // Speichern, reload: the form is as left
      await expect(page.getByTestId('unsaved')).toBeVisible();
      // phone: the editor sheet is still open, its own Speichern bar saves (v3's toolbar was always in view)
      if (size.name === 'phone') await page.getByTestId('sheet-save').click();
      else await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      await openEditor();
      await expect(page.getByTestId('page-select-1')).toHaveText('Nachtrag');
      await press(page.getByTestId('page-select-0'));
      const first = await order(page);
      await press(page.getByTestId('page-select-1'));
      const all = [...first, ...(await order(page))];
      expect(all).toContain(created);
      expect(all.at(-1)).toBe(last);
      expect(all.length).toBe(before.length + (size.touch ? 2 : 3));
      await expect(page.locator(`[data-key="${last}"]`)).toHaveAttribute('data-column', 'left');

      // A card opens the field's settings (WP-381); the Felddefinition is one step deeper (v3 Panel 3); back returns
      await press(page.locator(`[data-key="${last}"] .badge.type`));
      await expect(page.getByTestId('field-config')).toBeVisible();
      await press(page.getByTestId('cfg-edit-definition'));
      await expect(page.getByTestId('field-pane')).toBeVisible();
      await press(page.getByTestId('form-def-back'));
      await press(page.getByTestId('form-field-back'));
      await expect(page.getByTestId('form-preview')).toBeVisible();
    });

    test('2-column grid: a field dropped on the left or right half takes that width (phone: the card bar)', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${size.task}"]`).click();
      await page.getByTestId('task-pane').getByTestId('tab-form').click();
      await page.getByTestId('task-pane').getByTestId('step-0-edit').click();
      const editor = page.getByTestId('form-editor');
      await expect(editor).toBeVisible();
      const before = await order(page);
      if (!size.touch) {
        await dragTo(page, editor.getByTestId('tile-date'), 'zone-0-left');
        await expect(page.getByTestId('field-card')).toHaveCount(before.length + 1);
        const left = (await order(page))[0] ?? '';
        await expect(page.locator(`[data-key="${left}"]`)).toHaveAttribute('data-column', 'left');
        // the right half by mouse: the left card is single, so the free half beside it is a drop target (`side-0`)
        await dragTo(page, editor.getByTestId('tile-dropdown'), 'side-0');
        await expect(page.getByTestId('field-card')).toHaveCount(before.length + 2);
        const beside = (await order(page))[1] ?? '';
        await expect(page.locator(`[data-key="${beside}"]`)).toHaveAttribute('data-column', 'right');
        // the right half: a tile adds a field at the end, the card's bar sets its half (a drop on a right zone of a
        // later line is covered by the same Dest; the zone only exists while a drag is over that line)
        await editor.getByTestId('tile-dropdown').click();
        const added = (await order(page)).at(-1) ?? '';
        const card = page.locator(`[data-key="${added}"]`);
        await card.hover();
        await card.getByTestId('field-width-right').click();
        await expect(card).toHaveAttribute('data-column', 'right');
      } else {
        await editor.getByTestId('tile-date').tap();
        const last = (await order(page)).at(-1) ?? '';
        const card = page.locator(`[data-key="${last}"]`);
        await card.getByTestId('field-width-right').tap();
        await expect(card).toHaveAttribute('data-column', 'right');
        await card.getByTestId('field-width-left').tap();
        await expect(card).toHaveAttribute('data-column', 'left');
      }
      await expect(page.getByTestId('form-error')).toHaveCount(0);
    });

    test('Formular löschen: asks first, removes the task form, Speichern, reload, the form is gone', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${size.formTask}"]`).click();
      const pane = page.getByTestId('task-pane');
      await pane.getByTestId('tab-form').click();
      await pane.getByTestId('step-0-edit').click();
      await expect(page.getByTestId('form-editor')).toBeVisible();
      await page.getByTestId('form-delete').click();
      const dialog = page.getByTestId('confirm-delete');
      await expect(dialog).toContainText('Formular aus der Aufgabe entfernen?');
      await page.getByTestId('confirm-delete-action').click();
      await expect(page.getByTestId('task-pane')).toBeVisible();
      await expect(page.getByTestId('unsaved')).toBeVisible();
      // phone: the editor sheet is still open, its own Speichern bar saves (v3's toolbar was always in view)
      if (size.name === 'phone') await page.getByTestId('sheet-save').click();
      else await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${size.formTask}"]`).click();
      await page.getByTestId('task-pane').getByTestId('tab-form').click();
      await expect(page.getByTestId('step-0-edit')).toHaveCount(0);
    });
  });
}
