import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData, goldenFile } from '../golden';

/**
 * WP-335: the stage pane of the Objektart's builder (v3 StageInspector with the participant preview).
 * Mängelmelder is used because its template does not lock its stages (the Baumkataster does).
 * The journey runs at phone (390x844) and desktop (1280x800) size.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const URL_OF = '/admin/projects/stagestadt/types/meldung/builder';
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
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

/** Creates an admin account (the e2e server has `ADMIN_TOTP=off`: no code to confirm). */
function createAdmin(email: string): void {
  expect(admin(['create-admin', email]).status).toBe(0);
}

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'stagestadt', 'Stage Stadt']).status).toBe(0);
  createAdmin('stagedeploy@example.org');
  expect(admin(['add-membership', 'stagedeploy@example.org', 'stagestadt', 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'stagedeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/stagestadt/deploy', {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `stage${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'stagestadt', 'sachbearbeiter']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: new stage, rename in place, mark as end, preview as a role, delete', async ({ page }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const frame = page.getByTestId('builder-frame');

      // Nothing selected: v3's Standardansicht, with the role picker and the data. On a phone the
      // inspector is a sheet over the canvas (WP-345): the toolbar's "Details" opens it.
      const pane = page.getByTestId('stage-pane');
      if (size.name === 'phone') {
        await expect(pane).toBeHidden();
        await frame.getByTestId('open-inspector').click();
      }
      await expect(pane.getByText('Standardansicht')).toBeVisible();

      // "Phase" in the catalog adds a stage and opens it in the pane (phone: catalog sheet, then inspector sheet).
      if (size.name === 'phone') {
        await page.keyboard.press('Escape');
        await frame.getByTestId('open-catalog').click();
      }
      await page.getByRole('button', { name: 'Phase', exact: true }).click();
      const name = pane.getByRole('button', { name: 'Phasenname' });
      await expect(name).toHaveText('Neue Phase');
      await expect(pane.getByTestId('stage-type')).toHaveValue('intermediate');

      // Rename in place: Enter commits.
      await name.click();
      await pane.getByRole('textbox', { name: 'Phasenname' }).fill('Prüfung');
      await page.keyboard.press('Enter');
      await expect(pane.getByRole('button', { name: 'Phasenname' })).toHaveText('Prüfung');

      // Marking it as end writes process.end; the problems badge stays as it was.
      await pane.getByTestId('stage-type').selectOption('end');
      await expect(pane.getByTestId('stage-type')).toHaveValue('end');
      await expect(frame.getByTestId('unsaved')).toBeVisible();

      // The preview as a role dims what the role is not offered here.
      await pane.getByTestId('stage-role').selectOption('melder');
      const buttons = pane.getByTestId('stage-button');
      await expect(buttons.first()).toBeVisible();
      await expect(pane.locator('[data-testid="stage-button"][data-dimmed="true"]').first()).toBeVisible();
      // The Melder reads every property since f56811c51 (she reads who reported); the Handwerker does not read `melder`.
      await pane.getByTestId('stage-role').selectOption('handwerker');
      await expect(
        pane.locator('[data-testid="stage-property"][data-visible="false"]').first(),
      ).toBeVisible();

      // The field palette widens the pane (v3: 520 -> 720 px); a phone sheet is full width.
      const aside = frame.getByTestId('builder-inspector');
      if (size.name !== 'phone') {
        await expect.poll(async () => (await aside.boundingBox())?.width).toBe(520);
        await pane.getByTestId('stage-library-toggle').click();
        await expect.poll(async () => (await aside.boundingBox())?.width).toBe(720);
        await pane.getByTestId('stage-library-toggle').click();
      } else {
        await pane.getByTestId('stage-library-toggle').click();
        await expect(pane.getByTestId('stage-library')).toBeVisible();
        await pane.getByTestId('stage-library-toggle').click();
      }

      // Delete asks first (the kit's confirm).
      await pane.getByTestId('stage-delete').click();
      await expect(page.getByTestId('confirm-delete')).toContainText('Prüfung');
      await page.getByTestId('confirm-delete-action').click();
      if (size.name === 'phone') {
        // Nothing is selected any more: the sheet closes and the canvas is there again.
        await expect(pane).toBeHidden();
        await frame.getByTestId('open-inspector').click();
      }
      await expect(pane.getByText('Standardansicht')).toBeVisible();
    });
  });
}

test('a stage added in the pane survives Speichern and a reload', async ({ page }) => {
  await signIn(page);
  await page.goto(URL_OF);
  const frame = page.getByTestId('builder-frame');
  await page.getByRole('button', { name: 'Phase', exact: true }).click();
  await page.getByTestId('stage-pane').getByTestId('stage-type').selectOption('end');
  await frame.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(frame.getByTestId('unsaved')).toBeHidden();
  const draft = (await (await page.request.get('/builder-api/stagestadt/draft')).json()) as {
    overlay: string;
  };
  expect(draft.overlay).toContain('neue_phase');
  expect(draft.overlay).toMatch(/end:[\s\S]*neue_phase/);
  await page.reload();
  await expect(page.getByTestId('stage-pane').getByText('Standardansicht')).toBeVisible();
});
