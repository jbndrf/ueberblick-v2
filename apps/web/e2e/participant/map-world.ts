import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData } from '../golden';
import { rosterToken } from '../seed';

/**
 * The world of the real-map journeys (WP-745): the tree cadastre template with project zoom limits (`map.min_zoom` 8,
 * `max_zoom` 12), a second point type (Bank) with its own configured look, a view without a `$ref` style (so both types
 * draw by their look), the Cluster tool switched on for the Baumkontrolle, a crowd of trees that cluster at the start
 * view, and one tree in stage Maßnahme (its relation menu offers "Maßnahme anlegen").
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const MAP_KEY = 'kartenwegstadt';
export const ZOOM_MIN = 8;
export const ZOOM_MAX = 12;
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const CENTER: readonly [number, number] = [10.4515, 51.1657];
/** The two Objektarten' configured looks (WP-744): colour and icon each. */
export const LOOKS = { baum: '#2f855a', bank: '#d69e2e' } as const;
export const CROWD = 8;

type Json = Record<string, unknown>;
const at = (o: Json, key: string): Json => (o[key] ??= {}) as Json;

/** The golden tree cadastre, made into the template of this world. */
export function mapTemplate(): Json {
  const t = goldenData('templates/baumkataster/2.0.0.yaml') as Json;
  at(t, 'template')['key'] = 'kartenweg';
  const map = at(t, 'map');
  map['min_zoom'] = ZOOM_MIN;
  map['max_zoom'] = ZOOM_MAX;
  const roles = at(t, 'roles');
  const tools = at(at(at(roles, 'kontrolle'), 'app'), 'tools');
  tools['cluster'] = { availability: 'active' };
  at(at(t, 'types'), 'baum')['marker'] = { color: LOOKS.baum, icon: { key: 'tree-deciduous' } };
  at(t, 'types')['bank'] = {
    label: { de: 'Bank', en: 'Bench' },
    geometry: 'geometrie',
    permissions: { see: '$all', create: ['kontrolle', 'verwaltung'], write: ['kontrolle', 'verwaltung'] },
    marker: { color: LOOKS.bank, icon: { key: 'flag' } },
    properties: {
      geometrie: { type: 'geometry', geometry_type: 'point', required: true, label: 'Standort' },
    },
  };
  at(t, 'tasks')['bank_erfassen'] = {
    label: { de: 'Bank erfassen', en: 'Record bench' },
    on: '$map',
    who: ['kontrolle'],
    creates: 'bank',
    form: { geometrie: { tool: 'draw', required: true } },
  };
  at(t, 'views')['karte'] = {
    label: { de: 'Karte', en: 'Map' },
    source: { type: 'baum' },
    layers: {
      baeume: { source: { type: 'baum' }, renderer: 'maplibre-2d' },
      baenke: { source: { type: 'bank' }, renderer: 'maplibre-2d' },
    },
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

const uuid = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** The id of every live feature of a type, ordered by id. */
export function idsOfType(type: string): string[] {
  const db = openProjectDb(E2E_DATA_DIR, MAP_KEY);
  try {
    return db
      .prepare<{ id: string }>(
        "SELECT id FROM features WHERE type = ? AND lifecycle <> 'deleted' ORDER BY id",
      )
      .all(type)
      .map((r) => r.id);
  } finally {
    db.close();
  }
}

export async function seedMapWorld(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
): Promise<void> {
  admin(['create-project', MAP_KEY, MAP_KEY]);
  const created = admin(['create-admin', 'mapweg@example.org']);
  const url = /otpauth:\/\/\S+/.exec(created.out)?.[0];
  if (url === undefined) return; // a restarted worker finds the world there
  const secret = base32Decode(new URL(url).searchParams.get('secret') ?? '');
  expect(admin(['confirm-totp', 'mapweg@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'mapweg@example.org', MAP_KEY, 'verwaltung']).status).toBe(0);
  const file = join(mkdtempSync(join(tmpdir(), 'ub-mapweg-')), 'kartenweg.json');
  writeFileSync(file, JSON.stringify(mapTemplate()));
  expect(admin(['publish-template', file]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'mapweg@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${MAP_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'kartenweg@2' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();

  const field = await playwright.request.newContext({ baseURL });
  await field.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, MAP_KEY, 'p-seed', ['kontrolle']) },
  });
  const run = async (n: number, task: string, input: unknown, featureId?: string): Promise<void> => {
    const r = await field.post(`/api/p/${MAP_KEY}/runs`, {
      data: { id: uuid(n), task, configVersion: 1, input, ...(featureId === undefined ? {} : { featureId }) },
    });
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toMatchObject({ outcome: 'accepted' });
  };
  // a crowd that is one cluster at the start view (about 1 px apart at zoom 10)
  for (let i = 0; i < CROWD; i++)
    await run(100 + i, 'erfassen', {
      geometrie: { type: 'Point', coordinates: [CENTER[0] + i * 0.0004, CENTER[1] + i * 0.0004] },
      vitalitaet: 'v1',
    });
  // two benches far from the crowd and from each other (never one cluster)
  for (const [i, d] of [-0.15, 0.15].entries())
    await run(200 + i, 'bank_erfassen', {
      geometrie: { type: 'Point', coordinates: [CENTER[0] + d, CENTER[1] + 0.03] },
    });
  // the inspection binds the area around the tree: an area (verwaltung) holds the crowd
  const office = await playwright.request.newContext({ baseURL });
  await office.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, MAP_KEY, 'p-seed-office', ['verwaltung']) },
  });
  const r = 0.02;
  const ring = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
    [-r, -r],
  ].map(([x, y]) => [CENTER[0] + (x ?? 0), CENTER[1] + (y ?? 0)]);
  const area = await office.post(`/api/p/${MAP_KEY}/runs`, {
    data: {
      id: uuid(250),
      task: 'flaeche_anlegen',
      configVersion: 1,
      input: { name: 'Stadtpark', geometrie: { type: 'Polygon', coordinates: [ring] } },
    },
  });
  expect(area.status(), await area.text()).toBe(200);
  await office.dispose();
  const first = idsOfType('baum')[0];
  if (first === undefined) throw new Error('no tree was seeded');
  await run(300, 'kontrolle', { vitalitaet: 'v3', befund: 'Ast gebrochen' }, first);
  await field.dispose();
}

/** Signs in as a field participant of this world and waits for the map. */
export async function signInMap(page: Page, participant: string): Promise<void> {
  const token = rosterToken(E2E_DATA_DIR, MAP_KEY, participant, ['kontrolle']);
  await page.goto(`/login?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}

/** What MapLibre holds, as the renderer wrote it at the last settle (`data-map-state`, packages/ui/src/map/maplibre/probe.ts). */
export interface MapState {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  clusters: number;
  singles: number;
  iconImage: unknown;
  images: string[];
}

export async function readState(page: Page): Promise<MapState | undefined> {
  const raw = await page.getByTestId('map').getAttribute('data-map-state');
  return raw === null ? undefined : (JSON.parse(raw) as MapState);
}
