import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-336: v3's task pane (TaskConfigSidebar) in the Objektart's builder, at desktop and phone size:
 * select a task, rename it, add a condition, open the role picker, delete a new task with the confirm
 * dialog, Speichern, reload.
 * WP-352: the same pane's Formular (steps), Ergebnisse (Übergang zu, actions) and Definition (Farbe,
 * Symbol, Bestätigung) at both sizes.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/taskstadt/types/baum/builder';

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

/** Creates an admin account (the e2e server has `ADMIN_TOTP=off`: e-mail and password only, no code to confirm). */
function createAdmin(email: string): void {
  expect(admin(['create-admin', email]).status).toBe(0);
}

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'taskstadt', 'Task Stadt']).status).toBe(0);
  createAdmin('taskdeploy@example.org');
  expect(admin(['add-membership', 'taskdeploy@example.org', 'taskstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'taskdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/taskstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `task${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'taskstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  {
    name: 'desktop',
    viewport: { width: 1280, height: 800 },
    task: 'befund_ergaenzen',
    label: 'Befund desktop',
  },
  { name: 'phone', viewport: { width: 390, height: 844 }, task: 'verschieben', label: 'Verschieben phone' },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport });

    test('journey: select a task, edit it, add a condition, delete a new task, Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      // phone: the catalog is a sheet; the pane opens as a sheet when the task is selected
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${size.task}"]`).click();
      const pane = page.getByTestId('task-pane');
      await expect(pane).toBeVisible();
      await expect(pane.getByRole('tab')).toHaveCount(5);
      await expect(pane.getByTestId('task-key')).toHaveText(size.task);

      // Definition: the button text is the task's label.
      await pane.getByTestId('task-label').fill(size.label);
      await pane.getByTestId('task-label').blur();
      await expect(pane.getByTestId('task-name')).toHaveText(size.label);
      await expect(page.getByTestId('unsaved')).toBeVisible();

      // Bedingungen: a row, and the role picker (a dropdown on desktop, a sheet on a phone).
      await pane.getByTestId('tab-conditions').click();
      await pane.getByRole('button', { name: 'Bedingung hinzufügen' }).click();
      await expect(pane.getByLabel('Feld von Vergleich 1')).toBeVisible();
      await expect(pane.getByTestId('condition-error')).toHaveCount(0);
      await pane.getByRole('group', { name: 'Wer darf dies nutzen' }).getByRole('button').click();
      if (size.name === 'phone') {
        const sheet = page.getByRole('dialog', { name: 'Wer darf dies nutzen' });
        await expect(sheet).toBeVisible();
        await sheet.getByRole('button', { name: /^Fertig/ }).click();
        await expect(sheet).toBeHidden();
      } else {
        await expect(page.getByRole('listbox')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('listbox')).toBeHidden();
      }

      // YAML shows the task as text.
      await pane.getByTestId('tab-yaml').click();
      await expect(pane.getByTestId('task-yaml')).toHaveValue(/label:/);
      await pane.getByTestId('tab-definition').click();

      // Delete a new task: the dialog asks first.
      // phone: close the inspector sheet, add from the catalog sheet (the new task opens the pane again)
      if (size.name === 'phone') {
        await page.keyboard.press('Escape');
        await frame.getByTestId('open-catalog').click();
      }
      await page.getByRole('button', { name: 'Schaltfläche', exact: true }).click();
      await expect(pane.getByTestId('task-name')).toHaveText('Neue Aufgabe');
      await pane.getByTestId('task-delete').click();
      const dialog = page.getByTestId('confirm-delete');
      await expect(dialog).toContainText('Aufgabe „Neue Aufgabe“ löschen?');
      await dialog.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(pane.getByTestId('task-name')).toHaveText('Neue Aufgabe');
      await pane.getByTestId('task-delete').click();
      await page.getByTestId('confirm-delete-action').click();
      await expect(page.getByTestId('task-pane')).toHaveCount(0);

      // Speichern, reload: the edits stayed, the deleted task never was saved.
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      if (size.name === 'phone') await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${size.task}"]`).click();
      await expect(page.getByTestId('task-name')).toHaveText(size.label);
      await expect(page.locator('[data-path="tasks.neue_aufgabe"]')).toHaveCount(0);
    });

    test('journey: Farbe, Symbol, Bestätigung, a Standort step, Übergang zu and a lifecycle action, Speichern, reload', async ({
      page,
    }) => {
      const task = size.name === 'desktop' ? 'zuweisen' : 'befund_ergaenzen';
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${task}"]`).click();
      const pane = page.getByTestId('task-pane');
      await expect(pane).toBeVisible();

      // Definition: Farbe, Symbol, Bestätigung (+ Nachricht)
      await pane.getByTestId('task-color').fill('danger');
      await pane.getByTestId('task-color').blur();
      await pane.getByTestId('task-icon').fill('triangle-alert');
      await pane.getByTestId('task-icon').blur();
      await pane.getByTestId('task-confirm').check();
      await expect(pane.getByTestId('task-confirm-message')).toHaveValue(/wirklich/);
      await expect(pane.getByTestId('task-error')).toHaveCount(0);

      // Formular: a Standort step after the form (or alone), then the order
      await pane.getByTestId('tab-form').click();
      await pane.getByTestId('add-location').click();
      await expect(pane.locator('[data-kind="location"]')).toHaveCount(1);
      await expect(pane.getByTestId('steps-error')).toHaveCount(0);

      // Ergebnisse: Übergang zu and a lifecycle action with "nur wenn"
      await pane.getByTestId('tab-outcomes').click();
      await pane.getByTestId('outcome-transition').selectOption('kontrolliert');
      await pane.getByTestId('add-lifecycle').click();
      await expect(pane.locator('[data-kind="lifecycle"]')).toHaveCount(1);
      await pane.locator('[data-kind="lifecycle"] select').first().selectOption('archived');
      await expect(pane.getByTestId('outcome-error')).toHaveCount(0);

      // YAML shows the lot
      await pane.getByTestId('tab-yaml').click();
      const yaml = pane.getByTestId('task-yaml');
      await expect(yaml).toHaveValue(/kind: location/);
      await expect(yaml).toHaveValue(/color: danger/);
      await expect(yaml).toHaveValue(/lifecycle: archived/);
      await expect(yaml).toHaveValue(/confirm:/);

      // Speichern, reload: it stayed
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      if (size.name === 'phone') await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${task}"]`).click();
      await page.getByTestId('tab-yaml').click();
      await expect(page.getByTestId('task-yaml')).toHaveValue(/lifecycle: archived/);
      await page.getByTestId('tab-form').click();
      await expect(page.locator('[data-kind="location"]')).toHaveCount(1);
    });

    // WP-468: the elements below were built in WP-335 / WP-336 / WP-346 / WP-438 and had no spec driving them.
    async function openTask(page: Page): Promise<Locator> {
      await signIn(page);
      await page.goto(URL_OF);
      if (size.name === 'phone') await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      // A new button has no `when` yet (a task whose condition reads `self` cannot become an entry task).
      await page.getByRole('button', { name: 'Schaltfläche', exact: true }).click();
      const pane = page.getByTestId('task-pane');
      await expect(pane.getByTestId('task-name')).toHaveText('Neue Aufgabe');
      return pane;
    }

    test('Einstiegs-Aufgabe: the checkbox makes the task start a new Objekt (on: $map) and back', async ({
      page,
    }) => {
      const pane = await openTask(page);
      const entry = pane.getByTestId('task-entry');
      await expect(entry).not.toBeChecked();
      await entry.check();
      await expect(entry).toBeChecked();
      await expect(page.getByTestId('unsaved')).toBeVisible();
      await pane.getByTestId('tab-yaml').click();
      await expect(pane.getByTestId('task-yaml')).toHaveValue(/on: \$map/);
      await pane.getByTestId('tab-definition').click();
      await pane.getByTestId('task-entry').uncheck();
      await pane.getByTestId('tab-yaml').click();
      await expect(pane.getByTestId('task-yaml')).not.toHaveValue(/on: \$map/);
    });

    test('Beliebige Instanz | Nur eigene: Nur eigene writes the creator condition, Beliebige Instanz removes it', async ({
      page,
    }) => {
      const pane = await openTask(page);
      await pane.getByTestId('tab-conditions').click();
      const own = pane.getByRole('button', { name: 'Nur eigene' });
      const any = pane.getByRole('button', { name: 'Beliebiges Objekt' });
      await expect(any).toHaveAttribute('aria-pressed', 'true');
      await own.click();
      await expect(own).toHaveAttribute('aria-pressed', 'true');
      await expect(pane.getByTestId('task-ownership-error')).toHaveCount(0);
      await pane.getByTestId('tab-yaml').click();
      await expect(pane.getByTestId('task-yaml')).toHaveValue(/\$created_by == actor\.id/);
      await pane.getByTestId('tab-conditions').click();
      await pane.getByRole('button', { name: 'Beliebiges Objekt' }).click();
      await expect(pane.getByRole('button', { name: 'Beliebiges Objekt' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await pane.getByTestId('tab-yaml').click();
      await expect(pane.getByTestId('task-yaml')).not.toHaveValue(/\$created_by/);
    });

    test('inline role creation: a typed name in the role picker creates a role and selects it', async ({
      page,
    }) => {
      const pane = await openTask(page);
      await pane.getByTestId('tab-conditions').click();
      await pane.getByRole('group', { name: 'Wer darf dies nutzen' }).getByRole('button').click();
      const scope = size.name === 'phone' ? page.getByRole('dialog', { name: 'Wer darf dies nutzen' }) : page;
      await scope.getByRole('textbox', { name: 'Suchen …' }).fill('Prüfteam');
      await scope.getByText('„Prüfteam“ erstellen').click();
      if (size.name === 'phone') await scope.getByRole('button', { name: /^Fertig/ }).click();
      else await page.keyboard.press('Escape');
      await expect(
        pane.getByRole('group', { name: 'Wer darf dies nutzen' }).getByText('Prüfteam').first(),
      ).toBeVisible();
      await expect(page.getByTestId('unsaved')).toBeVisible();
    });

    test('Aktionsschaltfläche hinzufügen: the roll bar of a phase adds a button pinned to it and opens its task', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      await page.locator('[data-stage-node="kontrolliert"]').dispatchEvent('click');
      const stage = page.getByTestId('stage-pane');
      await expect(stage).toBeVisible();
      await expect(stage.getByTestId('stage-buttons')).toBeVisible();
      await stage.getByRole('button', { name: 'Aktionsschaltfläche hinzufügen' }).click();
      const pane = page.getByTestId('task-pane');
      await expect(pane.getByTestId('task-name')).toHaveText('Neue Aufgabe');
      await pane.getByTestId('tab-yaml').click();
      await expect(pane.getByTestId('task-yaml')).toHaveValue(/self\.stage == 'kontrolliert'/);
      await expect(page.getByTestId('unsaved')).toBeVisible();
    });
  });
}
