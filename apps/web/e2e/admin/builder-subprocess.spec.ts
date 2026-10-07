import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData } from '../golden';

/**
 * WP-436 (S4-5): sub-process links. The parent's canvas marks the task that creates a linked entry with
 * 'verknüpft' and the child's process name; the link opens the child's builder, whose canvas links back
 * ('Teil-Ablauf von'). Both sizes. The template is the golden baumkataster with the `lock` on the stage
 * options removed (a locked stage cannot be renamed; that is the document's refusal, unit-tested)
 * under its own key, so the other specs' copy stays as it is.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PASSWORD = 'correct horse battery';
const PROJECT = 'subprocstadt';
const URL_OF = `/admin/projects/${PROJECT}/types/baum/builder`;

test.use({ locale: 'de-DE' });

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

/** The e2e server has `ADMIN_TOTP=off` (the default): no code to confirm or type. */
function createAdmin(email: string): void {
  expect(admin(['create-admin', email]).status).toBe(0);
}

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  const template = goldenData('templates/baumkataster/1.0.0.yaml') as {
    template: { key: string };
    lock?: unknown;
  };
  template.template.key = 'subprocbaum';
  delete template.lock;
  const file = join(mkdtempSync(join(tmpdir(), 'ub-subproc-')), 'subprocbaum.yaml');
  writeFileSync(file, JSON.stringify(template));
  const overlay = goldenData('projects/musterstadt-baeume.yaml') as { extends: string };
  overlay.extends = 'subprocbaum@1';

  expect(admin(['create-project', PROJECT, 'Subproc Stadt']).status).toBe(0);
  createAdmin('subprocdeploy@example.org');
  expect(admin(['add-membership', 'subprocdeploy@example.org', PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', file]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'subprocdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: overlay });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/** A one-time code is single-use, so every sign-in is its own admin. */
async function signIn(page: Page): Promise<void> {
  const email = `subproc${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: open the parent builder, follow the link to the child, follow the back link', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      const link = canvas.locator('[data-task-id="massnahme_anlegen"] a[data-subprocess-link]');
      await expect(link).toContainText('verknüpft: Maßnahme');
      await expect(page.getByTestId('subprocess-back')).toHaveCount(0);
      await link.click();

      await expect(page).toHaveURL(new RegExp(`/admin/projects/${PROJECT}/types/massnahme/builder`));
      const back = page.getByTestId('subprocess-back');
      await expect(back).toContainText('Teil-Ablauf von: Baum');
      await back.getByRole('link', { name: 'Baum' }).click();

      await expect(page).toHaveURL(new RegExp(`/admin/projects/${PROJECT}/types/baum/builder`));
      await expect(
        canvas.locator('[data-task-id="massnahme_anlegen"] a[data-subprocess-link]'),
      ).toBeVisible();
    });
  });
}
