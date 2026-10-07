import { expect, test, type Page } from '@playwright/test';
import { goldenFile } from '../golden';
import { publish } from '../support/publish';
import { admin, createAdmin, signInAs, uniqueEmail } from './sign-in';

/**
 * WP-499: whole builder journeys of an admin, end to end at phone (390x844) and desktop (1280x800) size.
 * 1. A new Objektart with a field of every palette type, one select with options; Speichern, reload, publish.
 * 2. On the Mängelmelder (its template locks neither stages nor rules): a new phase, a task offered in it that
 *    moves the Objekt into it; Speichern; the preview login sees the task; publish; reload.
 */
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const TILES = [
  'short_text',
  'long_text',
  'number',
  'email',
  'date',
  'file',
  'dropdown',
  'multiple_choice',
  'smart_dropdown',
  'custom_table_selector',
] as const;

test.use({ locale: 'de-DE', actionTimeout: 8000 });
test.setTimeout(180_000);

test.beforeAll(() => {
  expect(admin(['publish-template', goldenFile('templates/baumkataster/1.0.0.yaml')]).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/maengelmelder/1.0.0.yaml')]).status).toBe(0);
});

/** Collects the page's script errors; the builder must run a whole journey without one. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function newProject(page: Page, name: string, template: string): Promise<string> {
  const email = uniqueEmail('journey');
  createAdmin(email);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
  await page.goto('/admin/projects/new');
  await page.getByLabel('Projektname').fill(name);
  await page.getByLabel('Vorlage').selectOption(template);
  await page.getByRole('button', { name: 'Projekt erstellen' }).click();
  const key = name.toLowerCase().replace(/ /g, '_');
  await expect(page).toHaveURL(new RegExp(`/admin/projects/${key}/participants$`));
  return key;
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });
    const phone = size.name === 'phone';

    test('journey: a new Objektart with a field of every type, Speichern, reload, publish', async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const key = await newProject(page, `Journey ${size.name}`, 'baumkataster@1');
      if (!(await page.getByTestId('group-types').isVisible()))
        await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
      await page.getByTestId('group-types').getByRole('button', { name: 'Objektart hinzufügen' }).click();
      await page.getByRole('menuitem', { name: 'Neue Objektart' }).click();
      await page.getByTestId('new-type-name').fill('Spielplatz');
      await page.getByTestId('new-type-create').click();
      await expect(page).toHaveURL(new RegExp(`/${key}/types/spielplatz/builder$`));
      await expect(page.getByTestId('builder-frame')).toBeVisible();
      if (phone) await page.keyboard.press('Escape'); // the sidebar sheet stays open after the dialog
      await page.getByRole('button', { name: 'Button hinzufügen' }).first().click();
      const pane = page.getByTestId('task-pane');
      await pane.getByTestId('tab-form').click();
      await pane.getByRole('button', { name: 'Formular', exact: true }).last().click();
      await pane.getByTestId('step-0-edit').click();
      await expect(page.getByTestId('form-editor')).toBeVisible();
      for (const tile of TILES) await page.getByTestId(`tile-${tile}`).click();
      await expect(page.getByTestId('field-card')).toHaveCount(TILES.length);

      // the 7th field is the dropdown: its definition gets a label and three options
      await page.locator('[data-key="neues_feld_7"] .badge.type').click();
      await page.getByTestId('cfg-edit-definition').click();
      const fp = page.getByTestId('field-pane');
      await fp.getByTestId('field-label').fill('Zustand');
      await fp.getByTestId('field-label').blur();
      for (const o of ['gut', 'mittel', 'schlecht']) {
        await fp.getByTestId('field-option-new').fill(o);
        await fp.getByRole('button', { name: 'Option hinzufügen' }).click();
      }

      // phone: the sheet has its own Speichern bar
      if (phone) await page.getByTestId('sheet-save').click();
      else
        await page
          .getByTestId('builder-frame')
          .getByRole('button', { name: 'Speichern', exact: true })
          .click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      const draft = (await (await page.request.get(`/builder-api/${key}/draft`)).json()) as {
        overlay: string;
      };
      expect(draft.overlay).toMatch(/neues_feld_7:\s+type: select\s+label:\s+de: Zustand/);
      expect(draft.overlay).toContain('schlecht');

      await page.reload();
      await expect(page.getByTestId('publish-bar')).toContainText('Nicht veröffentlicht');
      if (phone) await page.getByTestId('open-catalog').click();
      await page.locator('[data-path="tasks.neue_aufgabe"]').click();
      await page.getByTestId('task-pane').getByTestId('tab-form').click();
      await page.getByTestId('task-pane').getByTestId('step-0-edit').click();
      await expect(page.getByTestId('field-card')).toHaveCount(TILES.length);
      await expect(page.locator('[data-key="neues_feld_7"]').getByTestId('card-label')).toContainText(
        'Zustand',
      );
      await page.keyboard.press('Escape');
      await publish(page, { via: 'bar' });
      expect(errors).toEqual([]);
    });

    test('journey: a new phase and a task that moves into it; the preview sees it; publish, reload', async ({
      page,
      browser,
      baseURL,
    }) => {
      const errors = watchErrors(page);
      const mp = await newProject(page, `Meldung ${size.name}`, 'maengelmelder@1');
      await page.goto(`/admin/projects/${mp}/types/meldung/builder`);
      const frame = page.getByTestId('builder-frame');
      await expect(frame).toBeVisible();
      await frame.getByRole('button', { name: 'Phase hinzufügen' }).click();
      const stage = page.getByTestId('stage-pane');
      await stage.getByRole('button', { name: 'Phasenname' }).click();
      await stage.getByRole('textbox', { name: 'Phasenname' }).fill('Prüfung');
      await page.keyboard.press('Enter');
      if (phone) await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();

      if (phone) await frame.getByTestId('open-catalog').click();
      await page.getByRole('button', { name: 'Schaltfläche', exact: true }).click();
      const task = page.getByTestId('task-pane');
      await task.getByTestId('task-label').fill('Prüfen lassen');
      await task.getByTestId('task-label').blur();
      await task.getByTestId('task-stage').selectOption({ label: 'Prüfung' });
      await task.getByTestId('tab-form').click();
      await task.getByTestId('add-form').click();
      await task.getByTestId('step-0-edit').click();
      await page.locator('[data-testid^="library-"]').first().click();
      await page.getByTestId('form-close').click();
      await task.getByTestId('tab-outcomes').click();
      await task.getByTestId('outcome-transition').selectOption('neue_phase');
      if (phone) await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      const problems = (await (await page.request.get(`/builder-api/${mp}/problems?locale=de`)).json()) as {
        problems: { message: string }[];
      };
      expect(problems.problems).toEqual([]);

      // the preview follows the draft: a role signs in and its app config has the task
      type Preview = { logins: { role: string | null; token: string }[] };
      const preview = async (): Promise<Preview> =>
        (await (await page.request.get(`/builder-api/${mp}/preview`)).json()) as Preview;
      await expect.poll(async () => (await preview()).logins.length).toBeGreaterThan(0);
      const token = (await preview()).logins.find((l) => l.role !== null)?.token ?? '';
      const device = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        locale: 'de-DE',
        baseURL: baseURL ?? '',
      });
      const user = await device.newPage();
      await user.goto(`/login?token=${token}`);
      await expect(user).toHaveURL(/\/map/);
      await expect
        .poll(
          async () =>
            (await (await user.request.get('/participant-api/bootstrap')).text()).includes('Prüfen lassen'),
          {
            timeout: 30_000,
          },
        )
        .toBe(true);
      await device.close();

      await publish(page, { via: 'bar' });
      await page.reload();
      await expect(page.getByTestId('publish-bar')).toBeHidden();
      if (phone) await page.getByTestId('open-catalog').click();
      await expect(page.locator('[data-path^="tasks."]').filter({ hasText: 'Prüfen lassen' })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}
