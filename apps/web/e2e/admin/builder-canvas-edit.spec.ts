import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData } from '../golden';
import { publish } from '../support/publish';

/**
 * WP-435 (S4-4): editing on the Workflow canvas as in v3. The journey adds a phase ("Phase hinzufügen"), draws an arrow
 * from a button's exit dot to it, deletes the arrow with the Delete key, adds a button to a phase, reorders the buttons
 * of the Global container with the grip, deletes the added button from the right-click menu, saves and publishes. At
 * phone (390x844) and desktop (1280x800) size. The ops each gesture writes are unit-tested (`canvas/edit.spec.ts`).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PASSWORD = 'correct horse battery';
const PROJECT = 'kantenstadt';
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

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  // The golden baumkataster without the lock on the stage options, under its own key.
  const template = goldenData('templates/baumkataster/1.0.0.yaml') as {
    template: { key: string };
    lock?: unknown;
  };
  template.template.key = 'editbaum';
  delete template.lock;
  const file = join(mkdtempSync(join(tmpdir(), 'ub-edit-')), 'editbaum.yaml');
  writeFileSync(file, JSON.stringify(template));
  const overlay = goldenData('projects/musterstadt-baeume.yaml') as { extends: string };
  overlay.extends = 'editbaum@1';

  expect(admin(['create-project', PROJECT, 'Edit Stadt']).status).toBe(0);
  expect(admin(['create-admin', 'kantendeploy@example.org']).status).toBe(0);
  expect(admin(['add-membership', 'kantendeploy@example.org', PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', file]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'kantendeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: overlay });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/** A one-time code is single-use, so every sign-in is its own admin. */
async function signIn(page: Page): Promise<void> {
  const email = `kanten${(admins += 1)}@example.org`;
  expect(admin(['create-admin', email]).status).toBe(0);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  // each size draws from another button: the phone run's arrow stays in the published project
  { name: 'phone', width: 390, height: 844, task: 'befund_ergaenzen', label: 'Befund ergänzen' },
  { name: 'desktop', width: 1280, height: 800, task: 'verschieben', label: 'Baum verschieben' },
] as const;

const center = async (el: Locator): Promise<{ x: number; y: number }> => {
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error('no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A drag with a few moves in between: xyflow and the pointer drag both read the path, not only the ends. */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await center(from);
  const b = await center(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: add a phase, draw an arrow, delete it and draw it again, add and reorder buttons, delete one, publish', async ({
      page,
    }) => {
      // a long journey, and the admin CLI of the sign-in is slow on a busy machine
      test.setTimeout(120_000);
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      const stages = canvas.locator('[data-stage-node]');
      // the phone run leaves its phase behind: count from what is there
      await expect(stages.nth(3)).toBeVisible();
      const phases = await stages.count();
      expect(phases).toBeGreaterThanOrEqual(4);
      // On a phone the pane of a new selection is a sheet over the canvas: close it to keep editing.
      const closeSheet = async (): Promise<void> => {
        if (size.name === 'phone') await page.keyboard.press('Escape');
      };

      // "Phase hinzufügen" (v3: top left of the canvas)
      await canvas.getByTestId('canvas-add-stage').click();
      await expect(stages).toHaveCount(phases + 1);
      await closeSheet();
      const added = stages.last();

      // draw an arrow from the exit dot of a button to the new phase
      const edges = canvas.locator('.svelte-flow__edge');
      const before = await edges.count();
      const exit = canvas.locator(`[data-task-id="${size.task}"] .svelte-flow__handle.source`);
      await drag(page, exit, added.locator('.svelte-flow__handle.target'));
      await expect(edges).toHaveCount(before + 1);
      const arrow = canvas.locator(`.svelte-flow__edge[aria-label="${size.label}"]`);
      await expect(arrow).toHaveCount(1);

      // Delete removes it again (the keyboard path: focus, Enter selects, Delete); the button stays
      await arrow.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Delete');
      await expect(edges).toHaveCount(before);
      await expect(canvas.locator(`[data-task-id="${size.task}"]`)).toBeVisible();
      // the new phase has to be reachable before the project can be published: draw the arrow again
      await drag(page, exit, added.locator('.svelte-flow__handle.target'));
      await expect(edges).toHaveCount(before + 1);

      // "Button hinzufügen" at the end of a phase
      const inPhase = canvas.locator('[data-stage-node="massnahme"] [data-task-id]');
      const buttons = await inPhase.count();
      await canvas.locator('[data-add-task][data-scope="massnahme"]').click();
      await expect(inPhase).toHaveCount(buttons + 1);
      await closeSheet();

      // reorder the buttons of the Global container with the keyboard: Alt+ArrowDown
      const global = canvas.locator('[data-global-container] [data-task-id]');
      const idsOf = (list: Locator) => async (): Promise<(string | null)[]> =>
        list.evaluateAll((els) => els.map((e) => e.getAttribute('data-task-id')));
      const globalIds = idsOf(global);
      const order = await globalIds();
      await global.first().focus();
      await page.keyboard.press('Alt+ArrowDown');
      await expect.poll(globalIds).toEqual([order[1], order[0], ...order.slice(2)]);
      await global.nth(1).focus();
      await page.keyboard.press('Alt+ArrowUp');
      await expect.poll(globalIds).toEqual(order);

      // ... and the two buttons of the phase with the grip (pointer): the new button goes first
      const phaseIds = idsOf(inPhase);
      const [old, fresh] = await phaseIds();
      await drag(page, inPhase.nth(1).locator('.grip'), inPhase.nth(0));
      await expect.poll(phaseIds).toEqual([fresh, old]);

      // the right-click menu: delete the button that was added (confirm first)
      await canvas.locator(`[data-task-id="${fresh}"]`).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Aufgabe löschen' }).click();
      await expect(page.getByTestId('confirm-delete')).toBeVisible();
      await page.getByTestId('confirm-delete-action').click();
      await expect(inPhase).toHaveCount(buttons);
      await closeSheet();

      // save, then publish
      await page.getByTestId('builder-frame').getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByTestId('unsaved')).toBeHidden();
      await publish(page, { via: 'bar' });
      const status = await page.request.get(`/api/admin/p/${PROJECT}/draft/status`);
      expect(await status.json()).toMatchObject({ dirty: false });
    });

    test('a tool icon moves to another button; Alt copies it', async ({ page }) => {
      test.setTimeout(120_000);
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      // a fresh button of the phase "Maßnahme" has no form step: the target of the move
      const inPhase = canvas.locator('[data-stage-node="massnahme"] [data-task-id]');
      const buttons = await inPhase.count();
      await canvas.locator('[data-add-task][data-scope="massnahme"]').click();
      await expect(inPhase).toHaveCount(buttons + 1);
      if (size.name === 'phone') await page.keyboard.press('Escape');
      const fresh = await inPhase.last().getAttribute('data-task-id');
      if (!fresh) throw new Error('no key for the new button');
      const task = (key: string): Locator => canvas.locator(`[data-task-id="${key}"]`).first();
      const tools = (key: string): Locator => task(key).locator('.tool');
      // `befund_ergaenzen` has a form step; the new button has none (v3 `TaskCanvas.svelte:292-319`)
      await expect(tools('befund_ergaenzen')).toHaveCount(1);
      const target = await tools(fresh).count();
      // a plain drag moves the step
      await drag(page, tools('befund_ergaenzen').first(), task(fresh));
      await expect(page.getByTestId('unsaved')).toBeVisible();
      await expect(tools('befund_ergaenzen')).toHaveCount(0);
      await expect(tools(fresh)).toHaveCount(target + 1);
      // the drop selects the target; on a phone its pane is a sheet over the canvas
      if (size.name === 'phone') await page.keyboard.press('Escape');
      // with Alt the step is copied: the source keeps its own
      await page.keyboard.down('Alt');
      await drag(page, tools(fresh).first(), task('befund_ergaenzen'));
      await page.keyboard.up('Alt');
      await expect(tools('befund_ergaenzen')).toHaveCount(1);
      await expect(tools(fresh)).toHaveCount(target + 1);
    });

    test('right-click menu of a button, a phase and a tool icon: Schlüssel kopieren, delete entries', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      const menu = page.getByTestId('canvas-menu');
      const clip = (): Promise<string> => page.evaluate(() => navigator.clipboard.readText());

      // a button: "Schlüssel kopieren" puts its key on the clipboard; the delete entry is there
      await canvas.locator('[data-task-id="zuweisen"]').first().dispatchEvent('contextmenu');
      await expect(menu.getByRole('menuitem', { name: 'Schlüssel kopieren' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: /löschen|Ausblenden/ })).toBeVisible();
      await menu.getByRole('menuitem', { name: 'Schlüssel kopieren' }).click();
      await expect.poll(clip).toBe('zuweisen');
      await expect(canvas.getByTestId('canvas-note')).toHaveText('Schlüssel kopiert');

      // a phase: its key and the delete entry (a template phase is hidden instead)
      await canvas.locator('[data-stage-node="massnahme"]').dispatchEvent('contextmenu');
      await expect(menu.getByRole('menuitem', { name: /Phase löschen|Ausblenden/ })).toBeVisible();
      await menu.getByRole('menuitem', { name: 'Schlüssel kopieren' }).click();
      await expect.poll(clip).toBe('massnahme');

      // a tool icon: "Aus Aufgabe entfernen"
      await canvas
        .locator('[data-task-id="verschieben"]')
        .first()
        .locator('.tool')
        .first()
        .dispatchEvent('contextmenu');
      await expect(menu.getByRole('menuitem', { name: 'Aus Aufgabe entfernen' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    });

    // v3's "ID kopieren" (Deletable.svelte:62-73) was dead: no caller passed copyId, so v4 has no such entry.

    test('the right pane has v3 width per mode and the canvas shrinks beside it', async ({ page }) => {
      test.skip(size.name === 'phone', 'phone shows the pane as a sheet');
      await signIn(page);
      await page.goto(URL_OF);
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();
      const inspector = page.getByTestId('builder-inspector');
      await expect.poll(async () => (await inspector.boundingBox())?.width).toBe(520);
      const before = (await canvas.boundingBox())?.width ?? 0;
      await canvas.locator('[data-task-id="zuweisen"]').first().click();
      await expect.poll(async () => (await inspector.boundingBox())?.width).toBe(320);
      expect((await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(before);
    });
  });
}
