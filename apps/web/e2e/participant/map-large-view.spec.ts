import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { mapTemplate, readState, type MapState } from './map-world';
import { watchErrors } from './world';

/**
 * WP-850: the project has no `map.start`, so the start view fits all features (the benches lie in a later slice, far outside the trees).
 * WP-848: a map of more than one slice (4000 features looked at per slice, PASS_SLICE) is walked in slices when the sheet
 * filter changes. On the built app with real MapLibre: switching the Objektart Baum off leaves only the benches, switching
 * it on draws the trees again (read back from MapLibre, `data-map-state`), and nothing is logged as an error.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const GROSS_KEY = 'grosskartestadt';
const PASSWORD = 'correct horse battery';
const CENTER: readonly [number, number] = [10.4515, 51.1657];
const TREES = 4400; // more than one slice of 4000
const BENCHES = 2;
const uuid = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const { defaultBrowserType: _unused, ...PIXEL } = devices['Pixel 7'];
void _unused;

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

async function seed(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string): Promise<void> {
  admin(['create-project', GROSS_KEY, GROSS_KEY]);
  const created = admin(['create-admin', 'grosskarte@example.org']);
  const url = /otpauth:\/\/\S+/.exec(created.out)?.[0];
  if (url === undefined) return; // a restarted worker finds the world there
  const secret = base32Decode(new URL(url).searchParams.get('secret') ?? '');
  expect(admin(['confirm-totp', 'grosskarte@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'grosskarte@example.org', GROSS_KEY, 'verwaltung']).status).toBe(0);
  const template = mapTemplate() as { template: { key: string } };
  template.template.key = 'grossweg';
  // v3 opens at the project's `map.start` and never fits; the renderer fits the features only when none is set (WP-850)
  delete (template as unknown as { map: { start?: unknown } }).map.start;
  const file = join(mkdtempSync(join(tmpdir(), 'ub-grossweg-')), 'grossweg.json');
  writeFileSync(file, JSON.stringify(template));
  expect(admin(['publish-template', file]).status).toBe(0);
  const office = await playwright.request.newContext({ baseURL });
  const login = await office.post('/api/auth/login', {
    data: { email: 'grosskarte@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + 30_000) },
  });
  expect(login.status()).toBe(200);
  const deploy = await office.post(`/api/admin/p/${GROSS_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'grossweg@2' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await office.dispose();

  const field = await playwright.request.newContext({ baseURL });
  await field.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, GROSS_KEY, 'p-seed', ['kontrolle']) },
  });
  const run = async (
    n: number,
    task: string,
    coordinates: [number, number],
    input: object,
  ): Promise<void> => {
    const r = await field.post(`/api/p/${GROSS_KEY}/runs`, {
      data: {
        id: uuid(n),
        task,
        configVersion: 1,
        input: { geometrie: { type: 'Point', coordinates }, ...input },
      },
    });
    expect(r.status(), await r.text()).toBe(200);
  };
  // the trees lie on a grid inside the start view, in batches of runs; two benches inside their extent
  const side = Math.ceil(Math.sqrt(TREES));
  for (let from = 0; from < TREES; from += 40) {
    const batch: Promise<void>[] = [];
    for (let i = from; i < Math.min(from + 40, TREES); i++)
      batch.push(
        run(
          1000 + i,
          'erfassen',
          [
            CENTER[0] + ((i % side) - side / 2) * 0.0008,
            CENTER[1] + (Math.floor(i / side) - side / 2) * 0.0005,
          ],
          { vitalitaet: 'v2' },
        ),
      );
    await Promise.all(batch);
  }
  // the benches are delivered after the trees (a later slice) and lie far outside the trees' extent (WP-850)
  for (const [i, d] of [-0.15, 0.15].entries())
    await run(200 + i, 'bank_erfassen', [CENTER[0] + d, CENTER[1] + 0.1], {});
  await field.dispose();
}

test.setTimeout(240_000);
test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(240_000);
  await seed(playwright, baseURL ?? '');
});

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = watchErrors(page);
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

async function signIn(page: Page, participant: string): Promise<void> {
  const token = rosterToken(E2E_DATA_DIR, GROSS_KEY, participant, ['kontrolle']);
  await page.goto(`/login?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}

async function bounds(page: Page): Promise<readonly [number, number, number, number] | undefined> {
  return (
    (await readState(page)) as (MapState & { bounds?: readonly [number, number, number, number] }) | undefined
  )?.bounds;
}
/** Clusters and singles MapLibre draws now; the benches alone are at most two. */
async function shown(page: Page): Promise<number> {
  const s = await readState(page);
  return (s?.clusters ?? 0) + (s?.singles ?? 0);
}

for (const [name, use] of [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', PIXEL],
] as const) {
  test.describe(name, () => {
    test.use({ ...use, locale: 'de-DE' });

    test('a sheet filter change over more than one slice ends with the expected map', async ({ page }) => {
      await signIn(page, `p-gross-${name}-${Date.now()}`);
      // the start view fits the whole view, not the first slice: both far benches are inside it
      await expect
        .poll(async () => (await bounds(page)) !== undefined && (await shown(page)) > 0, { timeout: 60_000 })
        .toBe(true);
      await expect
        .poll(
          async () => {
            const b = await bounds(page);
            return (
              b !== undefined &&
              b[0] <= CENTER[0] - 0.15 &&
              b[2] >= CENTER[0] + 0.15 &&
              b[3] >= CENTER[1] + 0.1
            );
          },
          { timeout: 60_000 },
        )
        .toBe(true);
      await page.getByRole('button', { name: 'Filter' }).click();
      const sheet = page.getByRole('dialog', { name: 'Karteninhalt' });
      await sheet.getByRole('switch', { name: 'Baum' }).click();
      await expect(sheet.getByRole('switch', { name: 'Baum' })).not.toBeChecked();
      // only the two benches are left, far apart: two singles or one cluster (zoom decides), not the trees
      await expect.poll(async () => await shown(page), { timeout: 60_000 }).toBeLessThanOrEqual(BENCHES);
      await sheet.getByRole('tab', { name: 'Cluster' }).click();
      await sheet.getByRole('switch', { name: 'Gruppierung aufheben' }).click();
      await expect(sheet.getByText(`${BENCHES} einzeln angezeigt`)).toBeVisible({ timeout: 60_000 });
      await sheet.getByRole('switch', { name: 'Gruppierung aufheben' }).click();
      await sheet.getByRole('tab', { name: 'Einfach' }).click();
      await sheet.getByRole('switch', { name: 'Baum' }).click();
      await expect(sheet.getByRole('switch', { name: 'Baum' })).toBeChecked();
      // the trees are drawn again, after more than one slice of additions: more than the benches alone
      await expect.poll(async () => await shown(page), { timeout: 60_000 }).toBeGreaterThan(BENCHES);
    });
  });
}
