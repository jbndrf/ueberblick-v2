import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import type { TemplateFile } from '@ueberblick/core';
import {
  base32Decode,
  createPackBuilder,
  openProjectDb,
  packsDir,
  totpAt,
  type FetchRange,
  type PackTiles,
} from '@ueberblick/server';
import { E2E_DATA_DIR, E2E_PORT } from '../../../playwright.config';
import { rosterToken } from '../../seed';
import { admin, PASSWORD, STEP_MS } from './verify-world';

/**
 * WP-861: the world of the offline-tile journeys. Its own project `tilepackstadt`: one base layer of source type `xyz`
 * on a remote host (so the map reads it through the tile proxy, A-033) and one offline pack over it. The server's own
 * build of the pack fails on the e2e server (its guard refuses the closed local port); the world then builds it
 * in-process with the real pack builder, whose tile source hands out the fixture PNG `fixtures/packs/tile-pack.png`
 * (magenta). The proxy is answered by the spec with `tile-proxy.png` (cyan), so a pixel tells which source drew it.
 */
export const TILEPACK_KEY = 'tilepackstadt';
export const PACK_KEY = 'region';
export const LAYER_KEY = 'karte';
export const START_ZOOM = 3;
export const PACK_MAX_ZOOM = 3;
const EMAIL = 'tilepack@example.org';
const label = (de: string): { de: string } => ({ de });

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`../../../../../fixtures/packs/${name}`, import.meta.url)));
export const PACK_PNG = fixture('tile-pack.png');
export const PROXY_PNG = fixture('tile-proxy.png');

export const TILEPACK_TEMPLATE = {
  schema: 'ueberblick/1',
  template: { key: 'tilepack', version: '1.0.0' },
  map: {
    start: { center: [10.4515, 51.1657], zoom: START_ZOOM },
    layers: {
      [LAYER_KEY]: {
        label: label('Straßenkarte'),
        kind: 'base',
        source: { type: 'xyz', url: 'http://127.0.0.1:9/{z}/{x}/{y}.png' },
        on_at_start: true,
      },
    },
    packs: {
      [PACK_KEY]: {
        label: label('Region'),
        bounds: [-120, -60, 120, 80],
        min_zoom: 1,
        max_zoom: PACK_MAX_ZOOM,
        layers: [LAYER_KEY],
      },
    },
  },
  roles: {
    kontrolle: {
      label: label('Kontrolle'),
      app: { home: 'karte', views: { karte: {} }, tools: {}, shortcuts: {} },
    },
  },
  types: {
    baum: {
      label: label('Baum'),
      geometry: 'geometrie',
      permissions: { see: '$all', create: ['kontrolle'], write: ['kontrolle'] },
      marker: { color: '#2f855a', icon: { key: 'tree-deciduous' } },
      properties: {
        geometrie: { type: 'geometry', geometry_type: 'point', required: true, label: label('Standort') },
        titel: { type: 'text', required: true, label: label('Titel') },
      },
    },
  },
  tasks: {
    erfassen: {
      label: label('Baum erfassen'),
      on: '$map',
      creates: 'baum',
      when: "'kontrolle' in actor.roles",
      form: { geometrie: { tool: 'draw', required: true }, titel: {} },
    },
  },
  views: { karte: { label: label('Karte'), source: { type: 'baum' } } },
  tools: { draw: {} },
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const noRange: FetchRange = async () => {
  throw new Error('no archive source in this world');
};
/** The pack's tile source: every tile is the fixture PNG. */
const packTiles: PackTiles = async () => ({
  kind: 'ok',
  bytes: new Uint8Array(PACK_PNG),
  contentType: 'image/png',
  ext: 'png',
  etag: '',
  cached: false,
});

/** Waits until the server's own build has given up, then builds the pack from the fixture PNG. */
async function buildPack(): Promise<void> {
  const db = openProjectDb(E2E_DATA_DIR, TILEPACK_KEY);
  try {
    const states = (): string[] =>
      db
        .prepare<{ state: string }>('SELECT state FROM pack_builds')
        .all()
        .map((r) => r.state);
    for (let i = 0; i < 100 && !(states().length > 0 && states().every((s) => s === 'failed')); i++)
      await sleep(300);
    expect(states()).toEqual(['failed']);
    const builder = createPackBuilder({
      db,
      clock: { now: () => new Date().toISOString() },
      dir: packsDir(E2E_DATA_DIR, TILEPACK_KEY),
      file: () => TILEPACK_TEMPLATE as unknown as TemplateFile,
      fetchRange: noRange,
      tiles: packTiles,
    });
    expect(builder.rebuild(PACK_KEY)).toBe(1);
    expect(await builder.drain()).toBe(1);
    expect(states()).toEqual(['ready']);
  } finally {
    db.close();
  }
}

async function seed(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string): Promise<void> {
  if (admin(['create-project', TILEPACK_KEY, TILEPACK_KEY]).status !== 0) return; // a restarted worker finds it
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', EMAIL, TILEPACK_KEY, 'verwaltung']).status).toBe(0);
  const file = join(mkdtempSync(join(tmpdir(), 'ub-tilepack-')), 'tilepack.json');
  writeFileSync(file, JSON.stringify(TILEPACK_TEMPLATE));
  const published = admin(['publish-template', file]);
  expect(published.status, published.out).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${TILEPACK_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'tilepack@1' },
  });
  expect(await deploy.json(), published.out).toMatchObject({ ok: true });
  await ctx.dispose();
  await buildPack();
}

export const test = base.extend<object, { world: true }>({
  world: [
    async ({ playwright }, use) => {
      await seed(playwright, `http://localhost:${E2E_PORT}`);
      await use(true);
    },
    { scope: 'worker' },
  ],
});

export const fieldToken = (id: string): string => rosterToken(E2E_DATA_DIR, TILEPACK_KEY, id, ['kontrolle']);

/** Signs in as `participant` (its own preferences) and waits for the map canvas. */
export async function signInTilepack(page: Page, participant: string): Promise<void> {
  await page.goto(`/login?token=${encodeURIComponent(fieldToken(participant))}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}
