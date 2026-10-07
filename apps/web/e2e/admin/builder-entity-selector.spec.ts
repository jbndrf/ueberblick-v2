import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-393: v3's entity selector in the field config panel at desktop (mouse) and phone size (touch, the inspector
 * sheet and the full-screen role dialog): the palette tile places a reference to a table, "Teilnehmende" makes it a
 * participant field, "Kann jeden auswählen" writes the role rule, Speichern, reload: the dialog is filled again.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/entstadt/types/baum/builder';

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
  expect(admin(['create-project', 'entstadt', 'Entity Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'entdeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'entdeploy@example.org', 'entstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'entdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/entstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `ent${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, 'entstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport, hasTouch: size.touch });

    test('journey: a table selector becomes a participant selector with a role rule; Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const press = async (target: Locator): Promise<void> => (size.touch ? target.tap() : target.click());
      const openEditor = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator('[data-path="tasks.kontrolle"]').click();
        const pane = page.getByTestId('task-pane');
        await pane.getByTestId('tab-form').click();
        await pane.getByTestId('step-0-edit').click();
        await expect(page.getByTestId('form-editor')).toBeVisible();
      };
      const openPanel = async (key: string): Promise<void> => {
        await press(page.locator(`[data-key="${key}"] .badge.type`));
        await expect(page.getByTestId('field-config')).toBeVisible();
      };

      await openEditor();
      await press(page.getByTestId('tile-custom_table_selector'));
      const created = (await page.getByTestId('field-card').last().getAttribute('data-key')) ?? '';
      expect(created).toMatch(/^neues_feld/);
      await openPanel(created);
      const panel = page.getByTestId('field-config');
      const table = panel.getByTestId('entity-source-table').getByRole('radio');
      await expect(table).toHaveAttribute('aria-checked', 'true');
      await expect(panel.getByTestId('entity-configured')).toBeVisible();

      // Tabelle: the dialog has the table and "Rollen mit Sichtbarkeit", empty means every role
      await press(panel.getByTestId('entity-configure'));
      const modal = page.getByTestId('entity-modal');
      await expect(modal.getByText(/Leer lassen bedeutet: alle Rollen/)).toBeVisible();
      await press(modal.getByTestId('entity-done'));
      await expect(modal).toBeHidden();

      // Teilnehmende: "Kann jeden auswählen" writes the role rule
      await press(panel.getByTestId('entity-source-participants').getByRole('radio'));
      await expect(panel.getByTestId('entity-configured')).toHaveCount(0);
      await press(panel.getByTestId('entity-configure'));
      const dialog = page.getByTestId('entity-modal');
      await expect(dialog.getByTestId('entity-summary')).toHaveText('Alle Rollen können jeden auswählen.');
      await press(dialog.getByTestId('entity-any').getByRole('button').first());
      if (size.name === 'phone') {
        await press(
          page
            .getByRole('dialog')
            .last()
            .getByRole('checkbox', { name: /Verwaltung/ }),
        );
        await press(page.getByRole('dialog').last().getByRole('button', { name: 'Fertig (1)' }));
      } else {
        await press(page.getByRole('option', { name: /Verwaltung/ }));
        await dialog.getByRole('heading').click();
      }
      await expect(dialog.getByTestId('entity-any')).toContainText('Verwaltung');
      await expect(dialog.getByTestId('entity-summary')).toHaveText(
        'Alle übrigen Rollen können nur sich selbst auswählen.',
      );
      if (await dialog.isVisible()) await press(dialog.getByTestId('entity-done'));
      await expect(panel.getByTestId('entity-configured')).toBeVisible();

      // Speichern, reload: the dialog is filled again
      await expect(page.getByTestId('unsaved')).toBeVisible();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      await openEditor();
      await openPanel(created);
      await expect(page.getByTestId('entity-source-participants').getByRole('radio')).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await press(page.getByTestId('entity-configure'));
      await expect(page.getByTestId('entity-modal').getByTestId('entity-any')).toContainText('Verwaltung');
    });

    test('journey (WP-443): Mehrfachauswahl and Anzeigefeld of a table selector; Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const press = async (target: Locator): Promise<void> => (size.touch ? target.tap() : target.click());
      const openEditor = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator('[data-path="tasks.kontrolle"]').click();
        const pane = page.getByTestId('task-pane');
        await pane.getByTestId('tab-form').click();
        await pane.getByTestId('step-0-edit').click();
        await expect(page.getByTestId('form-editor')).toBeVisible();
      };
      const openDialog = async (key: string): Promise<Locator> => {
        await press(page.locator(`[data-key="${key}"] .badge.type`));
        await press(page.getByTestId('field-config').getByTestId('entity-configure'));
        const modal = page.getByTestId('entity-modal');
        await expect(modal).toBeVisible();
        return modal;
      };

      await openEditor();
      await press(page.getByTestId('tile-custom_table_selector'));
      const created = (await page.getByTestId('field-card').last().getAttribute('data-key')) ?? '';
      expect(created).toMatch(/^neues_feld/);
      let modal = await openDialog(created);

      // v3's switch is first and off; turning it on is saved with the field
      const many = modal.getByTestId('entity-many');
      await expect(modal.getByText('Mehrfachauswahl erlauben')).toBeVisible();
      await expect(many).toHaveAttribute('aria-checked', 'false');
      await press(many);
      await expect(many).toHaveAttribute('aria-checked', 'true');

      // Anzeigefeld: the default first, then the table's properties with their type
      const display = modal.getByTestId('entity-display');
      await expect(display).toContainText('Anzeigename (Standard)');
      await press(display.getByRole('button').first());
      if (size.name === 'phone') {
        await press(
          page
            .getByRole('dialog')
            .last()
            .getByText(/Lateinischer Name/),
        );
        const done = page
          .getByRole('dialog')
          .last()
          .getByRole('button', { name: /Fertig/ });
        if (await done.isVisible()) await press(done);
      } else {
        await press(page.getByRole('option', { name: /Lateinischer Name/ }));
      }
      await expect(display).toContainText('Lateinischer Name');
      // on a phone the sheet's own button may close the dialog too: press Fertig only while it stays open
      const closed = await modal.waitFor({ state: 'hidden', timeout: 1500 }).then(
        () => true,
        () => false,
      );
      if (!closed) await press(modal.getByTestId('entity-done'));
      await expect(modal).toBeHidden();

      await expect(page.getByTestId('unsaved')).toBeVisible();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      await openEditor();
      modal = await openDialog(created);
      await expect(modal.getByTestId('entity-many')).toHaveAttribute('aria-checked', 'true');
      await expect(modal.getByTestId('entity-display')).toContainText('Lateinischer Name');
    });

    test('journey (WP-481): Rollen with "Kann jeden auswählen" writes select; Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      const press = async (target: Locator): Promise<void> => (size.touch ? target.tap() : target.click());
      const openEditor = async (): Promise<void> => {
        if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
        await page.locator('[data-path="tasks.kontrolle"]').click();
        const pane = page.getByTestId('task-pane');
        await pane.getByTestId('tab-form').click();
        await pane.getByTestId('step-0-edit').click();
        await expect(page.getByTestId('form-editor')).toBeVisible();
      };
      const openDialog = async (key: string): Promise<Locator> => {
        await press(page.locator(`[data-key="${key}"] .badge.type`));
        await press(page.getByTestId('field-config').getByTestId('entity-configure'));
        const modal = page.getByTestId('entity-modal');
        await expect(modal).toBeVisible();
        return modal;
      };

      await openEditor();
      await press(page.getByTestId('tile-custom_table_selector'));
      const created = (await page.getByTestId('field-card').last().getAttribute('data-key')) ?? '';
      await press(page.locator(`[data-key="${created}"] .badge.type`));
      await press(page.getByTestId('field-config').getByTestId('entity-source-roles').getByRole('radio'));
      await press(page.getByTestId('field-config').getByTestId('entity-configure'));
      const dialog = page.getByTestId('entity-modal');
      await expect(dialog.getByTestId('entity-summary')).toHaveText('Alle Rollen können jeden auswählen.');
      await press(dialog.getByTestId('entity-any').getByRole('button').first());
      if (size.name === 'phone') {
        await press(
          page
            .getByRole('dialog')
            .last()
            .getByRole('checkbox', { name: /Verwaltung/ }),
        );
        await press(page.getByRole('dialog').last().getByRole('button', { name: 'Fertig (1)' }));
      } else {
        await press(page.getByRole('option', { name: /Verwaltung/ }));
        await dialog.getByRole('heading').click();
      }
      await expect(dialog.getByTestId('entity-any')).toContainText('Verwaltung');
      await expect(dialog.getByTestId('entity-summary')).toHaveText(
        'Alle übrigen Rollen können keine Rolle auswählen.',
      );
      if (await dialog.isVisible()) await press(dialog.getByTestId('entity-done'));

      await expect(page.getByTestId('unsaved')).toBeVisible();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      await openEditor();
      const again = await openDialog(created);
      await expect(again.getByTestId('entity-any')).toContainText('Verwaltung');
    });
  });
}
