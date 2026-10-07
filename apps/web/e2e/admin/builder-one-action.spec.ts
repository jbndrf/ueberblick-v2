import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData, goldenFile } from '../golden';

/**
 * C-004 step 1 (owner, 2026-10-05): one action = a condition and an outcome, carried out by people or automatically.
 * Mängelmelder in the builder at phone (390x844) and desktop (1280x800) size: the automatic action's own task
 * ("Eskalieren") is no button, its node reads the outcome in one line, the catalog lists it under "Aktionen" and the
 * filter "Automatisch" shows it; its pane has the sections Bedingung, Ergebnis and Wer.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const slugOf = (size: (typeof SIZES)[number]): string => `aktion${size.name}`;

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
  expect(admin(['create-admin', 'aktiondeploy@example.org']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  for (const size of SIZES) {
    expect(admin(['create-project', slugOf(size), `Aktion ${size.name}`]).status).toBe(0);
    expect(admin(['add-membership', 'aktiondeploy@example.org', slugOf(size), 'sachbearbeiter']).status).toBe(
      0,
    );
  }
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'aktiondeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  for (const size of SIZES) {
    const deploy = await ctx.post(`/api/admin/p/${slugOf(size)}/deploy`, {
      data: goldenData('projects/stadtwerke-meldungen.yaml'),
    });
    expect(await deploy.json()).toMatchObject({ ok: true });
  }
  await ctx.dispose();
});

async function signIn(page: Page, slug: string): Promise<void> {
  const email = `aktion${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, slug, 'sachbearbeiter']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('Eskalieren is no button; the automatic action shows its outcome; the filter lists it', async ({
      page,
    }) => {
      await signIn(page, slugOf(size));
      await page.goto(`/admin/projects/${slugOf(size)}/types/meldung/builder`);
      const frame = page.getByTestId('builder-frame');
      const canvas = frame.getByTestId('builder-canvas');

      // the canvas: the person actions are buttons, the own task of an automatic action is not
      await expect(canvas.locator('[data-task-id="bewerten"]').first()).toBeVisible();
      await expect(canvas.locator('[data-task-id="eskalieren"]')).toHaveCount(0);
      await expect(canvas.locator('[data-task-id="benachrichtigen"]')).toHaveCount(0);
      const node = canvas.locator('[data-rule-key="eskalieren.eskalation_nach_frist"]');
      await expect(node).toBeVisible();
      await expect(node.getByTestId('rule-outcome')).toContainText('Priorität → Hoch');

      // the catalog: one list "Aktionen" with the filter
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      const catalog = page.getByTestId('builder-catalog');
      const list = catalog.getByTestId('catalog-actions');
      await expect(list.locator('[data-path="tasks.bewerten"]')).toBeVisible();
      await expect(list.locator('[data-path="tasks.eskalieren"]')).toHaveCount(0);
      await catalog.getByTestId('catalog-filter-automatic').click();
      await expect(list.locator('[data-path="tasks.eskalieren.auto.eskalation_nach_frist"]')).toBeVisible();
      await expect(list.locator('[data-path="tasks.bewerten"]')).toHaveCount(0);
      await catalog.getByTestId('catalog-filter-people').click();
      await expect(list.locator('[data-path="tasks.bewerten"]')).toBeVisible();
      await expect(list.locator('[data-path="tasks.eskalieren.auto.eskalation_nach_frist"]')).toHaveCount(0);

      // the pane of the automatic action has the same two sections as a task
      await catalog.getByTestId('catalog-filter-automatic').click();
      await list.locator('[data-path="tasks.eskalieren.auto.eskalation_nach_frist"]').click();
      const pane = page.getByTestId('rule-pane');
      await expect(pane.getByRole('tab')).toHaveText(['Bedingung', 'Ergebnis']);
    });

    test('the stage preview bar offers the person actions and no own task of an automatic action', async ({
      page,
    }) => {
      await signIn(page, slugOf(size));
      await page.goto(`/admin/projects/${slugOf(size)}/types/meldung/builder`);
      const frame = page.getByTestId('builder-frame');
      // The node itself, not a task button inside it (as builder-task.spec does).
      await frame
        .getByTestId('builder-canvas')
        .locator('[data-stage-node="offen"]')
        .first()
        .dispatchEvent('click');
      // Phone: the inspector is a sheet; a selection may open it, otherwise the toolbar's "Details" does.
      if (size.name === 'phone') {
        const pane = page.getByTestId('stage-pane');
        await pane
          .waitFor({ state: 'visible', timeout: 2000 })
          .catch(() => frame.getByTestId('open-inspector').click());
      }
      const bar = page.getByTestId('stage-pane').getByTestId('stage-buttons');
      await expect(bar.locator('[data-task="bewerten"]')).toBeVisible();
      await expect(bar.locator('[data-task="eskalieren"]')).toHaveCount(0);
      await expect(bar.locator('[data-task="benachrichtigen"]')).toHaveCount(0);
      await expect(bar.locator('[data-automatic="true"]')).toHaveCount(0);
    });
  });
}
