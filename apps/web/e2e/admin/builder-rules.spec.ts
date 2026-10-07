import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { publish } from '../support/publish';

/**
 * WP-438: the Auslöser choices the engine now supports, in the rule pane at phone and desktop size: a rule
 * "Wenn Bedingungen zutreffen" (edited with the rows) and a rule "Nach 6 Stunden, seit betritt Phase" with its
 * "In Phase"; Speichern, Veröffentlichen, reload: both read back as the same choices.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const;

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

test.beforeAll(() => {
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
});

async function signIn(page: Page, email: string): Promise<void> {
  expect(admin(['create-admin', email]).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport });
    const phone = size.name === 'phone';

    test('journey: a "when" rule and an elapsed rule since entering a phase, in hours; save, publish, reload', async ({
      page,
    }) => {
      await signIn(page, `zeit-${size.name}@example.org`);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Zeit ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `zeit_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));
      await publish(page, { via: 'bar' });

      await page.goto(`/admin/projects/${project}/types/baum/builder`);
      const frame = page.getByTestId('builder-frame');
      const pane = page.getByTestId('rule-pane');
      const addRule = async (): Promise<string> => {
        if (phone) await frame.getByTestId('open-catalog').click();
        await page.getByRole('button', { name: 'Automatisch', exact: true }).click();
        await expect(pane).toBeVisible();
        return (await pane.getAttribute('data-rule')) ?? '';
      };

      // Rule 1: "Wenn Bedingungen zutreffen" with a row
      const when = await addRule();
      await pane.getByTestId('rule-trigger-kind').selectOption('when');
      await expect(pane.getByTestId('rule-trigger-when')).toBeVisible();
      await pane
        .getByTestId('rule-trigger-when')
        .getByRole('button', { name: 'Bedingung hinzufügen' })
        .click();
      await expect(pane.getByTestId('rule-error')).toHaveCount(0);

      // Rule 2: "Nach" 6 Stunden "Seit" betritt Phase, "In Phase" Maßnahme
      if (phone) await page.keyboard.press('Escape');
      const elapsed = await addRule();
      await pane.getByTestId('rule-trigger-kind').selectOption('elapsed');
      await pane.getByTestId('rule-trigger-unit').selectOption('hours');
      await pane.getByTestId('rule-trigger-after').fill('6');
      await pane.getByTestId('rule-trigger-after').blur();
      await pane.getByTestId('rule-trigger-since').selectOption('entered');
      await pane.getByTestId('rule-trigger-entered-stage').selectOption('massnahme');
      await expect(pane.getByTestId('rule-error')).toHaveCount(0);

      // Speichern, Veröffentlichen, reload
      if (phone) await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await frame.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
      const deployed = page.waitForResponse(
        (r) => r.url().includes('/deploy') && r.request().method() === 'POST',
      );
      await page.getByTestId('deploy-overview').getByRole('button', { name: 'Veröffentlichen' }).click();
      expect((await deployed).ok()).toBe(true);
      await page.reload();

      const open = async (rule: string): Promise<void> => {
        if (phone) await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
        await page.locator(`[data-path="tasks.${rule.replace('.', '.auto.')}"]`).click();
      };
      await open(elapsed);
      await expect(pane.getByTestId('rule-trigger-kind')).toHaveValue('elapsed');
      await expect(pane.getByTestId('rule-trigger-after')).toHaveValue('6');
      await expect(pane.getByTestId('rule-trigger-unit')).toHaveValue('hours');
      await expect(pane.getByTestId('rule-trigger-since')).toHaveValue('entered');
      await expect(pane.getByTestId('rule-trigger-entered-stage')).toHaveValue('massnahme');
      if (phone) await page.keyboard.press('Escape');
      await open(when);
      await expect(pane.getByTestId('rule-trigger-kind')).toHaveValue('when');
      await expect(pane.getByTestId('rule-trigger-when')).toBeVisible();
    });
  });
}
