import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import type { TemplateFile } from '@ueberblick/core';
import {
  base32Decode,
  createPackBuilder,
  openProjectDb,
  packsDir,
  totpAt,
  type FetchRange,
} from '@ueberblick/server';
import { E2E_DATA_DIR, E2E_PORT } from '../../../playwright.config';
import { rosterToken } from '../../seed';
import { admin, PASSWORD, STEP_MS } from './verify-world';
import { fixturePmtiles } from './pmtiles-fixture';

/**
 * WP-843: the world of the step-5 verify journeys (advanced features, Projekt-Chat, offline packs). Its own project
 * `step5stadt`: a tree type, the chat on for the role `kontrolle`, the tools Ansichten and Cluster offered (off until the
 * person switches them on, as v3's "Advanced features"), and one offline pack over a `pmtiles` layer. The build of that
 * pack fails on the e2e server (no network, as in the admin spec); the world then builds it in-process from a tiny
 * fixture archive through the real pack builder, so the server's manifest and download routes serve a real ready pack.
 */
export const STEP5_KEY = 'step5stadt';
export const CENTER: readonly [number, number] = [10.4515, 51.1657];
const EMAIL = 'step5@example.org';
const label = (de: string): { de: string } => ({ de });
const roleApp = {
  home: 'karte',
  views: { karte: {} },
  tools: { chat: {}, views: { availability: 'offered' }, cluster: { availability: 'offered' } },
  shortcuts: {},
};

export const PACK_KEY = 'innenstadt';
const PACK_ZOOM = { min: 1, max: 3 };

export const STEP5_TEMPLATE = {
  schema: 'ueberblick/1',
  template: { key: 'step5', version: '1.0.0' },
  map: {
    start: { center: [...CENTER], zoom: 10 },
    layers: {
      osm: {
        label: label('Straßenkarte'),
        kind: 'base',
        source: { type: 'preset', preset: 'osm' },
        on_at_start: true,
      },
      luft: {
        label: label('Luftbild'),
        kind: 'overlay',
        source: { type: 'pmtiles', url: 'http://127.0.0.1:9/luft.pmtiles', tile_type: 'raster' },
      },
    },
    packs: {
      [PACK_KEY]: {
        label: label('Innenstadt'),
        bounds: [10.3, 51.1, 10.6, 51.3],
        min_zoom: PACK_ZOOM.min,
        max_zoom: PACK_ZOOM.max,
        layers: ['luft'],
      },
    },
  },
  roles: { kontrolle: { label: label('Kontrolle'), app: roleApp } },
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
      who: ['kontrolle'],
      form: { geometrie: { tool: 'draw', required: true }, titel: {} },
    },
  },
  views: { karte: { label: label('Karte'), source: { type: 'baum' } } },
  tools: { draw: {}, chat: {}, views: {}, cluster: {} },
};

const ARCHIVE_ZOOM = 3;

/** The fixture archive of the pack's source, read by byte range like a remote one. */
function fixtureFetch(): FetchRange {
  const bytes = fixturePmtiles(ARCHIVE_ZOOM);
  return async (_url, offset, length) => bytes.slice(offset, offset + length);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Waits until the server's own build of the pack has given up (its source is a closed port), then builds it from the fixture. */
async function buildPack(): Promise<void> {
  const db = openProjectDb(E2E_DATA_DIR, STEP5_KEY);
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
      dir: packsDir(E2E_DATA_DIR, STEP5_KEY),
      file: () => STEP5_TEMPLATE as unknown as TemplateFile,
      fetchRange: fixtureFetch(),
    });
    expect(builder.rebuild(PACK_KEY)).toBe(1);
    expect(await builder.drain()).toBe(1);
    expect(states()).toEqual(['ready']);
  } finally {
    db.close();
  }
}

/** Creates the project (once), publishes and deploys `step5@1` and builds its pack. */
async function seed(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string): Promise<void> {
  if (admin(['create-project', STEP5_KEY, STEP5_KEY]).status !== 0) return; // a restarted worker finds it
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', EMAIL, STEP5_KEY, 'verwaltung']).status).toBe(0);
  const file = join(mkdtempSync(join(tmpdir(), 'ub-step5-')), 'step5.json');
  writeFileSync(file, JSON.stringify(STEP5_TEMPLATE));
  const published = admin(['publish-template', file]);
  expect(published.status, published.out).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${STEP5_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'step5@1' },
  });
  expect(await deploy.json(), published.out).toMatchObject({ ok: true });
  await ctx.dispose();
  await buildPack();
}

let counter = 0;
const uuid = (): string =>
  `00000000-0000-7000-8000-${String((Date.now() % 1e9) * 1000 + (counter++ % 1000)).padStart(12, '0')}`;

export const fieldToken = (id: string): string => rosterToken(E2E_DATA_DIR, STEP5_KEY, id, ['kontrolle']);

export interface Step5World {
  /** Plants a tree (a run as a field participant) and returns its id. */
  plant(titel: string, at: readonly [number, number]): Promise<string>;
  /** `author` (a participant of the role kontrolle) writes `body` in the Projekt-Chat. */
  say(author: string, body: string): Promise<void>;
}

export const test = base.extend<object, { world: Step5World }>({
  world: [
    async ({ playwright }, use) => {
      const baseURL = `http://localhost:${E2E_PORT}`;
      await seed(playwright, baseURL);
      const as = async (id: string): Promise<APIRequestContext> => {
        const ctx = await playwright.request.newContext({ baseURL });
        await ctx.post('/api/auth/exchange', { data: { token: fieldToken(id) } });
        return ctx;
      };
      await use({
        async plant(titel, at) {
          const field = await as('p-step5-seed');
          const r = await field.post(`/api/p/${STEP5_KEY}/runs`, {
            data: {
              id: uuid(),
              task: 'erfassen',
              configVersion: 1,
              input: { geometrie: { type: 'Point', coordinates: [...at] }, titel },
            },
          });
          expect(r.status(), await r.text()).toBe(200);
          expect(await r.json()).toMatchObject({ outcome: 'accepted' });
          await field.dispose();
          const db = openProjectDb(E2E_DATA_DIR, STEP5_KEY);
          try {
            const row = db
              .prepare<{ id: string }>(
                "SELECT id FROM features WHERE json_extract(properties, '$.titel') = ?",
              )
              .get(titel);
            if (row === undefined) throw new Error(`no feature with titel ${titel}`);
            return row.id;
          } finally {
            db.close();
          }
        },
        async say(author, body) {
          const ctx = await as(author);
          const r = await ctx.post(`/api/p/${STEP5_KEY}/tools/chat`, { data: { id: uuid(), body } });
          expect(r.status(), await r.text()).toBeLessThan(300);
          await ctx.dispose();
        },
      });
    },
    { scope: 'worker' },
  ],
});

/** Signs in as `participant` (its own preferences and queue) and waits for the map. */
export async function signInStep5(page: Page, participant: string): Promise<void> {
  await page.goto(`/login?token=${encodeURIComponent(fieldToken(participant))}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}

/** A unique text per test, size and repeat (the data directory outlives a repeat). */
export const unique = (
  what: string,
  size: string,
  info: { repeatEachIndex: number; retry: number },
): string => `${what}-${size}-${info.repeatEachIndex}-${info.retry}-${Date.now() % 100000}`;
