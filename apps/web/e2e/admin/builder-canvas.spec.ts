import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData } from '../golden';

/**
 * WP-334: the builder's Workflow view draws the Objektart's process (v3's task canvas). The spec
 * opens the builder at a phone and a desktop size, sees the canvas, renames a stage, saves, reloads
 * and sees the new label. The template is the golden baumkataster with the `lock` on the stage
 * options removed (a locked stage cannot be renamed; that is the document's refusal, unit-tested)
 * under its own key, so the other specs' copy stays as it is.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PASSWORD = 'correct horse battery';
const PROJECT = 'canvasstadt';
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
  template.template.key = 'canvasbaum';
  delete template.lock;
  // A second button to the same stage as "Kontrolle durchführen": two parallel arrows (WP-476).
  const tasks = (template as unknown as { tasks: Record<string, unknown> }).tasks;
  for (const [key, de] of [
    ['dringend_melden', 'Dringend melden'],
    ['sofort_melden', 'Sofort melden'],
  ] as const) {
    tasks[key] = {
      label: { de, en: de },
      on: 'baum',
      who: ['kontrolle'],
      then: [{ set: { stage: "'massnahme'" } }],
    };
  }
  const file = join(mkdtempSync(join(tmpdir(), 'ub-canvas-')), 'canvasbaum.yaml');
  writeFileSync(file, JSON.stringify(template));
  const overlay = goldenData('projects/musterstadt-baeume.yaml') as { extends: string };
  overlay.extends = 'canvasbaum@1';

  expect(admin(['create-project', PROJECT, 'Canvas Stadt']).status).toBe(0);
  createAdmin('canvasdeploy@example.org');
  expect(admin(['add-membership', 'canvasdeploy@example.org', PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', file]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'canvasdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: overlay });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/** A one-time code is single-use, so every sign-in is its own admin. */
async function signIn(page: Page): Promise<void> {
  const email = `canvas${(admins += 1)}@example.org`;
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

    test('journey: open the builder, see the canvas, rename a stage, save, reload, the new label is shown', async ({
      page,
    }, info) => {
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      for (const key of ['erfasst', 'kontrolliert', 'massnahme', 'erledigt']) {
        await expect(canvas.locator(`[data-stage-node="${key}"]`)).toHaveCount(1);
      }
      await expect(canvas.locator('[data-global-container]')).toHaveCount(1);
      await expect(canvas.locator('.entry-node')).toContainText('Baum erfassen');
      await expect(canvas.locator('[data-rule-key]').first()).toBeAttached();
      await expect(canvas.locator('.svelte-flow__edge').first()).toBeAttached();
      await page.screenshot({ path: info.outputPath(`canvas-${size.name}.png`) });

      const stage = canvas.locator('[data-stage-node="kontrolliert"]');
      if (size.name === 'phone') {
        // The canvas has the full width; the catalog and the inspector are sheets (WP-345). Selecting
        // the stage opens its pane as a sheet; the name is renamed there and closing keeps the stage selected.
        const box = await canvas.boundingBox();
        // full width inside the admin page's gutters (the catalog and the inspector take none)
        expect(box?.width).toBeGreaterThanOrEqual(size.width - 40);
        await expect(page.getByTestId('builder-catalog')).toBeHidden();
        await stage.locator('.stage-title').click();
        const pane = page.getByTestId('stage-pane');
        await expect(pane).toBeVisible();
        await pane.getByRole('button', { name: 'Phasenname' }).click();
        await pane.getByRole('textbox', { name: 'Phasenname' }).fill(`Geprüft ${size.name}`);
        await page.keyboard.press('Enter');
        await page.keyboard.press('Escape');
        await expect(pane).toBeHidden();
        await expect(page.getByTestId('builder-canvas')).toBeVisible();
      } else {
        await stage.locator('.stage-title').click();
        const input = stage.locator('input');
        await input.fill(`Geprüft ${size.name}`);
        await input.press('Enter');
      }
      await expect(stage).toContainText(`Geprüft ${size.name}`);
      await expect(page.getByTestId('unsaved')).toBeVisible();

      await page.getByTestId('builder-frame').getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();

      await page.reload();
      await expect(
        page.getByTestId('builder-canvas').locator('[data-stage-node="kontrolliert"]'),
      ).toContainText(`Geprüft ${size.name}`);
    });

    test('edges: an arrow is labelled with the button text, parallel arrows between the same stages are offset', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      const edges = canvas.locator('.svelte-flow__edge');
      await expect(edges.first()).toBeAttached();
      // the label is the task button's text
      const urgent = canvas.locator('.svelte-flow__edge[aria-label="Dringend melden"]');
      const instant = canvas.locator('.svelte-flow__edge[aria-label="Sofort melden"]');
      await expect(urgent).toHaveCount(1);
      await expect(instant).toHaveCount(1);
      // both run from the same container to the same stage: their paths differ (v3 curveOffset)
      const d = (l: typeof urgent): Promise<string | null> =>
        l.locator('path.svelte-flow__edge-path').first().getAttribute('d');
      const [a, b] = [await d(urgent), await d(instant)];
      expect(a).not.toBeNull();
      expect(a).not.toBe(b);
    });
  });
}
