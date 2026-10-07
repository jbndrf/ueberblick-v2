import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData } from '../golden';

/**
 * WP-366: where the admin drags a node on the Workflow canvas is stored per project (E-21), for every node
 * kind. The spec drags a stage, the Global container and the entry marker, waits for the save, reloads and
 * sees each at the same flow position. At desktop size the drag is a mouse drag, at phone size a touch drag
 * (CDP touch events). The route answers 401 without a session.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PASSWORD = 'correct horse battery';
const PROJECT = 'layoutstadt';
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
  const template = goldenData('templates/baumkataster/1.0.0.yaml') as { template: { key: string } };
  template.template.key = 'layoutbaum';
  const file = join(mkdtempSync(join(tmpdir(), 'ub-layout-')), 'layoutbaum.yaml');
  writeFileSync(file, JSON.stringify(template));
  const overlay = goldenData('projects/musterstadt-baeume.yaml') as { extends: string };
  overlay.extends = 'layoutbaum@1';

  expect(admin(['create-project', PROJECT, 'Layout Stadt']).status).toBe(0);
  createAdmin('layoutdeploy@example.org');
  expect(admin(['add-membership', 'layoutdeploy@example.org', PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', file]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'layoutdeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: overlay });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

/** A one-time code is single-use, so every sign-in is its own admin. */
async function signIn(page: Page): Promise<void> {
  const email = `layout${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const SIZES = [
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'desktop', width: 1280, height: 800, touch: false },
] as const;

const NODES = ['stage:kontrolliert', 'global', 'entry:erfassen'] as const;
const node = (page: Page, id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
const flowAt = async (page: Page, id: string) =>
  (await node(page, id).evaluate((el) => (el as HTMLElement).style.transform)).replace(/\s+/g, '');

/** A swipe from (x, y) by (dx, dy): a mouse drag, or touch events over CDP (what a finger sends). */
async function swipe(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  touch: boolean,
): Promise<void> {
  if (!touch) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
    await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', px: number, py: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }],
    });
  await send('touchStart', x, y);
  for (let i = 1; i <= 8; i += 1) await send('touchMove', x + (dx * i) / 8, y + (dy * i) / 8);
  await send('touchEnd', x + dx, y + dy);
  await cdp.detach();
}

/** The canvas is zoomed out to fit and a side pane may cover part of it: pan until the node's corner is in view. */
async function reveal(page: Page, id: string, touch: boolean): Promise<{ x: number; y: number }> {
  const view = await page.getByTestId('builder-canvas').boundingBox();
  if (!view) throw new Error('no canvas');
  for (let tries = 0; tries < 4; tries += 1) {
    const box = await node(page, id).boundingBox();
    if (!box) throw new Error(`no box for ${id}`);
    // a draggable spot of the node: not a button, an input or a handle (those are `nodrag`, as in v3)
    const found = await page.evaluate(
      ({ nid, bx, by, bw, bh }) => {
        for (let gy = by + 2; gy < by + bh - 1; gy += 2)
          for (let gx = bx + 2; gx < bx + bw - 1; gx += 2) {
            const el = document.elementFromPoint(gx, gy);
            if (el?.closest('.svelte-flow__node')?.getAttribute('data-id') !== nid) continue;
            if (el.closest('.nodrag, .svelte-flow__handle, button, input, a')) continue;
            return { x: gx, y: gy };
          }
        return null;
      },
      { nid: id, bx: box.x, by: box.y, bw: box.width, bh: box.height },
    );
    const at = found ?? { x: box.x + box.width * 0.6, y: box.y + 6 };
    const inside = (p: { x: number; y: number }) =>
      p.x > view.x + 12 &&
      p.x < view.x + view.width - 12 &&
      p.y > view.y + 12 &&
      p.y < view.y + view.height - 12;
    if (inside(at)) return at;
    // an empty spot of the pane to grab
    const grab = await page.evaluate(
      ({ vx, vy, vw, vh }) => {
        for (let gy = vy + 20; gy < vy + vh - 20; gy += 16)
          for (let gx = vx + 20; gx < vx + vw - 20; gx += 16)
            if (document.elementFromPoint(gx, gy)?.classList.contains('svelte-flow__pane'))
              return { x: gx, y: gy };
        return null;
      },
      { vx: view.x, vy: view.y, vw: view.width, vh: view.height },
    );
    if (!grab) throw new Error('no empty pane to pan');
    const dx = Math.max(-100, Math.min(100, view.x + view.width / 2 - (box.x + box.width / 2)));
    const dy = Math.max(-100, Math.min(100, view.y + view.height / 2 - (box.y + box.height / 2)));
    await swipe(page, grab.x, grab.y, dx, dy, touch);
  }
  throw new Error(`${id} could not be brought into view`);
}

test('the layout route is for signed-in admins only', async ({ request }) => {
  expect((await request.get(`/builder-api/${PROJECT}/layout?type=baum`)).status()).toBe(401);
  const put = await request.put(`/builder-api/${PROJECT}/layout`, { data: { type: 'baum', nodes: [] } });
  expect(put.status()).toBe(401);
});

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });

    test('drag a stage, the Global container and the entry marker; reload; each is at the same place', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(URL_OF);
      await expect(page.getByTestId('builder-canvas')).toBeVisible();
      await expect(node(page, 'stage:kontrolliert')).toBeVisible();
      const before: Record<string, string> = {};
      for (const id of NODES) before[id] = await flowAt(page, id);

      for (const id of NODES) {
        const saved = page.waitForResponse(
          (r) => r.url().includes(`/builder-api/${PROJECT}/layout`) && r.request().method() === 'PUT',
        );
        const from = await reveal(page, id, size.touch);
        await swipe(page, from.x, from.y, 40, 30, size.touch);
        expect((await saved).status()).toBe(200);
        expect(await flowAt(page, id)).not.toBe(before[id]);
      }
      const after: Record<string, string> = {};
      for (const id of NODES) after[id] = await flowAt(page, id);

      await page.reload();
      await expect(node(page, 'stage:kontrolliert')).toBeVisible();
      for (const id of NODES) expect(await flowAt(page, id)).toBe(after[id]);
      // a node nobody moved keeps the automatic place
      expect(await flowAt(page, 'stage:erledigt')).toMatch(/px/);
      const stored = await page.request.get(`/builder-api/${PROJECT}/layout?type=baum`);
      const ids = ((await stored.json()) as { nodes: { id: string }[] }).nodes.map((n) => n.id).sort();
      expect(ids).toEqual([...NODES].sort());
    });
  });
}
