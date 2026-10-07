import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR, E2E_PORT } from '../../playwright.config';
import { goldenData } from '../golden';
import { rosterToken } from '../seed';
import { readState } from './map-world';

/**
 * The world of the map-navigation journeys (WP-758): the golden tree cadastre with no zoom limits (so a fitted drill-down
 * can open the crowd into single markers), a second base map and an overlay (the Layer sheet), and a crowd of eight
 * trees that is one cluster at the start view, beside the marker of the area that holds them (about 1 px apart at zoom 10). One of them was inspected into stage
 * "Maßnahme", so the cluster detail has two rows (7 and 1). The newest run is the last tree, so Zuletzt lists it first.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const NAV_KEY = 'navigationstadt';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
export const CENTER: readonly [number, number] = [10.4515, 51.1657];
export const CROWD = 8;
/** Stage rows of the cluster detail: the inspected tree is alone in its stage. */
export const SPLIT = { big: CROWD - 1, small: 1 } as const;
export const BASES = { first: 'Straßenkarte', second: 'OSM Deutschland' } as const;
export const OVERLAY = 'Flurkarte';

type Json = Record<string, unknown>;

/** The golden tree cadastre with a second base map and an overlay. */
export function navTemplate(): Json {
  const t = goldenData('templates/baumkataster/2.0.0.yaml') as Json;
  (t['template'] as Json)['key'] = 'navweg';
  const layers = (t['map'] as Json)['layers'] as Json;
  layers['osm_de'] = {
    label: { de: BASES.second, en: 'OSM Germany' },
    kind: 'base',
    source: { type: 'preset', preset: 'osm_de' },
  };
  layers['flur'] = {
    label: { de: OVERLAY, en: 'Cadastral map' },
    kind: 'overlay',
    source: { type: 'wms', url: 'https://geoportal.example.de/wms/flur', layers: 'flurstuecke' },
  };
  delete t['migrations'];
  return t;
}

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

const uuid = (n: number): string => `00000000-0000-7000-8000-${String(7580 + n).padStart(12, '0')}`;

/** Creates the project and records the crowd. Runs once per worker (a restarted worker finds the world there). */
export async function seedNavWorld(playwright: PlaywrightWorkerArgs['playwright']): Promise<void> {
  const baseURL = `http://localhost:${E2E_PORT}`;
  admin(['create-project', 'navigationstadt', 'navigationstadt']);
  const created = admin(['create-admin', 'navweg@example.org']);
  const url = /otpauth:\/\/\S+/.exec(created.out)?.[0];
  if (url === undefined) return;
  const secret = base32Decode(new URL(url).searchParams.get('secret') ?? '');
  expect(admin(['confirm-totp', 'navweg@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'navweg@example.org', NAV_KEY, 'verwaltung']).status).toBe(0);
  const file = join(mkdtempSync(join(tmpdir(), 'ub-navweg-')), 'navweg.json');
  writeFileSync(file, JSON.stringify(navTemplate()));
  expect(admin(['publish-template', file]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'navweg@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${NAV_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'navweg@2' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();

  const field = await playwright.request.newContext({ baseURL });
  await field.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, NAV_KEY, 'p-seed', ['kontrolle']) },
  });
  const run = async (n: number, task: string, input: unknown, featureId?: string): Promise<void> => {
    const r = await field.post(`/api/p/${NAV_KEY}/runs`, {
      data: { id: uuid(n), task, configVersion: 1, input, ...(featureId === undefined ? {} : { featureId }) },
    });
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toMatchObject({ outcome: 'accepted' });
  };
  for (let i = 0; i < CROWD; i++)
    await run(i, 'erfassen', {
      geometrie: { type: 'Point', coordinates: [CENTER[0] + i * 0.0004, CENTER[1] + i * 0.0004] },
      vitalitaet: 'v1',
    });
  // the inspection binds the area around the tree: an area (verwaltung) holds the crowd
  const office = await playwright.request.newContext({ baseURL });
  await office.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, NAV_KEY, 'p-seed-office', ['verwaltung']) },
  });
  const r = 0.02;
  // asymmetric: it holds the crowd, but its marker (the centroid) sits well apart from the crowd's cluster
  const ring = [
    [-r, -r],
    [10 * r, -r],
    [10 * r, 10 * r],
    [-r, 10 * r],
    [-r, -r],
  ].map(([x, y]) => [CENTER[0] + (x ?? 0), CENTER[1] + (y ?? 0)]);
  const area = await office.post(`/api/p/${NAV_KEY}/runs`, {
    data: {
      id: uuid(40),
      task: 'flaeche_anlegen',
      configVersion: 1,
      input: { name: 'Stadtpark', geometrie: { type: 'Polygon', coordinates: [ring] } },
    },
  });
  expect(area.status(), await area.text()).toBe(200);
  await office.dispose();
  const first = firstTree();
  await run(50, 'kontrolle', { vitalitaet: 'v3', befund: 'Ast gebrochen' }, first);
  await field.dispose();
}

function firstTree(): string {
  const db = openProjectDb(E2E_DATA_DIR, NAV_KEY);
  try {
    const row = db.prepare<{ id: string }>("SELECT id FROM features WHERE type = 'baum' ORDER BY id").get();
    if (row === undefined) throw new Error('no tree was seeded');
    return row.id;
  } finally {
    db.close();
  }
}

/** Signs in as a field participant of this world and waits for the map to settle at its start view. */
export async function signInNav(page: Page, participant: string): Promise<void> {
  const token = rosterToken(E2E_DATA_DIR, NAV_KEY, participant, ['kontrolle']);
  await page.goto(`/login?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('map')).toHaveAttribute('data-idle', 'true', { timeout: 30_000 });
}

/** The map has drawn the crowd as one group (what the start view shows). */
export async function crowdSettled(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readState(page))?.clusters, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1);
}

/** The centre of the map in degrees, from the `data-center` seam. */
export async function centerOf(page: Page): Promise<[number, number]> {
  const raw = (await page.getByTestId('map').getAttribute('data-center')) ?? '0,0';
  const [lon, lat] = raw.split(',').map(Number);
  return [lon ?? 0, lat ?? 0];
}
