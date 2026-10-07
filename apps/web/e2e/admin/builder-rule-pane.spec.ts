import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';

/**
 * WP-377: v3's rule pane (AutomationConfig) in the Objektart's builder, at desktop and phone size: add a (glossary-lint-ignore)
 * rule from the catalog ("Regel"), name it, set the Auslöser, add a condition row and a step (Wert setzen),
 * Speichern, reload, open the rule again; then a rule of the template that runs a shared task.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/regelstadt/types/baum/builder';

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

function createAdmin(email: string): void {
  expect(admin(['create-admin', email]).status).toBe(0);
}

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'regelstadt', 'Regel Stadt']).status).toBe(0);
  createAdmin('ruledeploy@example.org');
  expect(admin(['add-membership', 'ruledeploy@example.org', 'regelstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'ruledeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/regelstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `rule${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'regelstadt', 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport });
    const phone = size.name === 'phone';

    test('journey: add a rule, name it, set trigger, condition and step, Speichern, reload', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      if (phone) await frame.getByTestId('open-catalog').click();
      await page.getByRole('button', { name: 'Automatisch', exact: true }).click();
      const pane = page.getByTestId('rule-pane');
      await expect(pane).toBeVisible();
      await expect(pane.getByRole('tab')).toHaveCount(2);
      const key = (await pane.getAttribute('data-rule')) ?? '';

      // header: the name
      await pane.getByTestId('rule-name').fill(`Prüfung ${size.name}`);
      await pane.getByTestId('rule-name').blur();
      await expect(page.getByTestId('unsaved')).toBeVisible();

      // Auslöser: after a time, since the last change
      await pane.getByTestId('rule-trigger-kind').selectOption('elapsed');
      await pane.getByTestId('rule-trigger-since').selectOption('changed');
      await pane.getByTestId('rule-trigger-after').fill('30');
      await pane.getByTestId('rule-trigger-after').blur();
      await expect(pane.getByTestId('rule-error')).toHaveCount(0);

      // Bedingung: a row
      await pane.getByTestId('rule-tab-btn-condition').click();
      await pane
        .getByTestId('rule-tab-condition')
        .getByRole('button', { name: 'Bedingung hinzufügen' })
        .click();
      await expect(pane.getByTestId('rule-tab-condition')).toBeVisible();

      // Schritte: a value is set
      await pane.getByTestId('rule-tab-btn-steps').click();
      await pane.getByTestId('add-set').click();
      await expect(pane.locator('[data-kind="set"]')).toHaveCount(1);

      // Speichern, reload: it stayed
      if (phone) await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      if (phone) await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${key.replace('.', '.auto.')}"]`).click();
      await expect(page.getByTestId('rule-name')).toHaveValue(`Prüfung ${size.name}`);
      await expect(page.getByTestId('rule-trigger-kind')).toHaveValue('elapsed');
      await expect(page.getByTestId('rule-trigger-since')).toHaveValue('changed');
      await expect(page.getByTestId('rule-trigger-after')).toHaveValue('30');
      await page.getByTestId('rule-tab-btn-steps').click();
      await expect(page.locator('[data-kind="set"]')).toHaveCount(1);
    });

    // WP-480: v3's "In Phase" on a scheduled trigger is a `when` pin; it survives Speichern and reload.
    test('"In Phase" on a scheduled trigger is kept after Speichern and reload', async ({ page }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');
      if (phone) await frame.getByTestId('open-catalog').click();
      await page.getByRole('button', { name: 'Automatisch', exact: true }).click();
      const pane = page.getByTestId('rule-pane');
      const key = (await pane.getAttribute('data-rule')) ?? '';
      await pane.getByTestId('rule-trigger-kind').selectOption('schedule');
      const phase = pane.getByTestId('rule-trigger-schedule-stage');
      await expect(phase).toHaveValue('');
      await phase.selectOption({ index: 1 });
      const chosen = await phase.inputValue();
      expect(chosen).not.toBe('');
      if (phone) await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await page.reload();
      if (phone) await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.locator(`[data-path="tasks.${key.replace('.', '.auto.')}"]`).click();
      await expect(page.getByTestId('rule-trigger-kind')).toHaveValue('schedule');
      await expect(page.getByTestId('rule-trigger-schedule-stage')).toHaveValue(chosen);
    });

    test('a rule of the template that runs a shared task: its name and "Aufgabe öffnen"', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      if (phone) await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
      await page.locator('[data-path="tasks.massnahme_anlegen.auto.massnahme_bei_schaden"]').click();
      const pane = page.getByTestId('rule-pane');
      await expect(pane.getByTestId('rule-trigger-kind')).toHaveValue('task');
      await pane.getByTestId('rule-tab-btn-steps').click();
      await expect(pane.getByTestId('rule-run-task')).toBeVisible();
      await pane.getByTestId('rule-open-task').click();
      await expect(page.getByTestId('task-pane')).toHaveAttribute('data-task', 'massnahme_anlegen');
    });

    test('the canvas draws a rule as a node with "automatisch" and its trigger; a task that creates a linked object has the branch icon', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      // v3 `task-canvas/RuleNode.svelte`: bolt, name, "auto", trigger, what it runs
      const node = canvas.locator('[data-rule-key="massnahme_anlegen.massnahme_bei_schaden"]');
      await expect(node).toBeVisible();
      await expect(node.getByText('automatisch', { exact: true })).toBeVisible();
      await expect(node).toContainText(/nachdem die Aufgabe .+ lief/);
      await expect(node).toContainText('führt aus:');
      // ... with the branch icon: it creates a linked object (v3 "Erstellt eine verknüpfte Instanz")
      await expect(node.getByRole('img', { name: 'Erstellt ein verknüpftes Objekt' })).toBeVisible();
      // the same icon on the task row of a task that creates another Objektart
      const row = canvas.locator('[data-task-id="massnahme_anlegen"]').first();
      await expect(row.getByRole('img', { name: 'Erstellt ein verknüpftes Objekt' })).toBeVisible();
      // a click on the node opens the rule in the pane
      await node.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('rule-pane')).toHaveAttribute(
        'data-rule',
        'massnahme_anlegen.massnahme_bei_schaden',
      );
    });
  });
}
