import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import type { StoredGeometry } from './world';

/**
 * The world of the field-tool journeys (WP-753): one small project whose field role draws an area (Fläche) and a line
 * (Weg), pins a point with a photo (Foto-Objekt) and a point with attached files (Dokument). The two file properties
 * differ as in v3's MediaGallery: photos take images (`max_files` 3), files take PDFs (`max_files` 2).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const FIELD_KEY = 'feldwerkzeuge';
export const FILES_MAX = 2;
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
/** The map view of the template starts here. */
export const START: readonly [number, number] = [10.4515, 51.1657];
const START_ZOOM = 10;

type Json = Record<string, unknown>;
const geometryProperty = (kind: string): Json => ({
  type: 'geometry',
  geometry_type: kind,
  required: true,
  label: { de: 'Standort', en: 'Location' },
});
const permissions = { see: '$all', create: ['feld'], write: ['feld'] };
const layer = (type: string): Json => ({ source: { type }, renderer: 'maplibre-2d' });

/** The template of this world, as plain data (JSON is YAML for `publish-template`). */
export function fieldTemplate(): Json {
  return {
    schema: 'ueberblick/1',
    template: { key: 'feldwerk', version: '1.0.0' },
    map: {
      start: { center: [...START], zoom: START_ZOOM },
      layers: {
        osm: {
          label: { de: 'Straßenkarte', en: 'Street map' },
          kind: 'base',
          source: { type: 'preset', preset: 'osm' },
          on_at_start: true,
        },
      },
    },
    roles: {
      feld: {
        label: { de: 'Feld', en: 'Field' },
        app: { home: 'karte', views: { karte: {} }, tools: { photo: {} } },
      },
    },
    types: {
      flaeche: {
        label: { de: 'Fläche', en: 'Area' },
        geometry: 'geometrie',
        permissions,
        properties: {
          name: { type: 'text', required: true, label: { de: 'Name', en: 'Name' } },
          geometrie: geometryProperty('polygon'),
        },
      },
      weg: {
        label: { de: 'Weg', en: 'Path' },
        geometry: 'geometrie',
        permissions,
        properties: {
          name: { type: 'text', required: true, label: { de: 'Name', en: 'Name' } },
          geometrie: geometryProperty('linestring'),
        },
      },
      fotopunkt: {
        label: { de: 'Foto-Objekt', en: 'Photo object' },
        geometry: 'geometrie',
        permissions,
        properties: {
          name: { type: 'text', required: true, label: { de: 'Name', en: 'Name' } },
          geometrie: geometryProperty('point'),
          foto: { type: 'file', accept: ['image/*'], max_files: 3, label: { de: 'Foto', en: 'Photo' } },
        },
      },
      dokument: {
        label: { de: 'Dokument', en: 'Document' },
        geometry: 'geometrie',
        permissions,
        properties: {
          name: { type: 'text', required: true, label: { de: 'Name', en: 'Name' } },
          geometrie: geometryProperty('point'),
          unterlagen: {
            type: 'file',
            accept: ['application/pdf'],
            max_files: FILES_MAX,
            label: { de: 'Unterlagen', en: 'Files' },
          },
        },
      },
    },
    tasks: {
      flaeche_anlegen: {
        label: { de: 'Fläche anlegen', en: 'Create area' },
        on: '$map',
        who: ['feld'],
        creates: 'flaeche',
        form: { name: { required: true }, geometrie: { tool: 'draw', required: true } },
      },
      weg_anlegen: {
        label: { de: 'Weg anlegen', en: 'Create path' },
        on: '$map',
        who: ['feld'],
        creates: 'weg',
        form: { name: { required: true }, geometrie: { tool: 'draw', required: true } },
      },
      foto_melden: {
        label: { de: 'Foto melden', en: 'Report photo' },
        on: '$map',
        who: ['feld'],
        creates: 'fotopunkt',
        form: {
          name: { required: true },
          geometrie: { tool: 'draw', required: true },
          foto: { tool: 'photo' },
        },
      },
      dokument_anlegen: {
        label: { de: 'Dokument anlegen', en: 'Create document' },
        on: '$map',
        who: ['feld'],
        creates: 'dokument',
        form: {
          name: { required: true },
          geometrie: { tool: 'draw', required: true },
          unterlagen: { tool: 'file' },
        },
      },
    },
    views: {
      karte: {
        label: { de: 'Karte', en: 'Map' },
        source: { type: 'flaeche' },
        layers: {
          flaechen: layer('flaeche'),
          wege: layer('weg'),
          fotos: layer('fotopunkt'),
          dokumente: layer('dokument'),
        },
      },
    },
  };
}

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

/** Creates the project and deploys the template (a worker that restarts finds the project there). */
export async function seedFieldWorld(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
): Promise<void> {
  admin(['create-project', FIELD_KEY, FIELD_KEY]);
  const email = 'feldwerkzeuge@example.org';
  const created = admin(['create-admin', email]);
  const url = /otpauth:\/\/\S+/.exec(created.out)?.[0];
  if (url === undefined) return;
  const secret = base32Decode(new URL(url).searchParams.get('secret') ?? '');
  expect(admin(['confirm-totp', email, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', email, FIELD_KEY, 'verwaltung']).status).toBe(0);
  const file = join(mkdtempSync(join(tmpdir(), 'ub-feldwerk-')), 'feldwerk.json');
  writeFileSync(file, JSON.stringify(fieldTemplate()));
  expect(admin(['publish-template', file]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${FIELD_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'feldwerk@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
}

/** Signs in as a field participant of this world and waits for the map. */
export async function signInField(page: Page, participant: string): Promise<void> {
  const token = rosterToken(E2E_DATA_DIR, FIELD_KEY, participant, ['feld']);
  await page.goto(`/login?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}

/** How many runs of a task the server has accepted. */
export function acceptedRuns(task: string): number {
  const db = openProjectDb(E2E_DATA_DIR, FIELD_KEY);
  try {
    return (
      db
        .prepare<{ n: number }>("SELECT count(*) AS n FROM runs WHERE task = ? AND outcome = 'accepted'")
        .get(task)?.n ?? 0
    );
  } finally {
    db.close();
  }
}

/** The feature the latest accepted run of a task wrote `property` to, with the server's current value of it. */
export function lastValue(
  task: string,
  property: string,
): { featureId: string; geometry?: StoredGeometry; value: unknown } | undefined {
  const db = openProjectDb(E2E_DATA_DIR, FIELD_KEY);
  try {
    const row = db
      .prepare<{ feature_id: string; geometry: string | null; properties: string }>(
        `SELECT o.feature_id AS feature_id, f.geometry AS geometry, f.properties AS properties
           FROM runs r JOIN observations o ON o.run_id = r.id AND o.property = ?
           JOIN features f ON f.id = o.feature_id
          WHERE r.task = ? AND r.outcome = 'accepted' ORDER BY r.seq DESC LIMIT 1`,
      )
      .get(property, task);
    if (row === undefined) return undefined;
    return {
      featureId: row.feature_id,
      ...(row.geometry === null ? {} : { geometry: JSON.parse(row.geometry) as StoredGeometry }),
      value: (JSON.parse(row.properties) as Record<string, unknown>)[property],
    };
  } finally {
    db.close();
  }
}

/** The sha256 of every blob the server holds. */
export function blobShas(): string[] {
  const db = openProjectDb(E2E_DATA_DIR, FIELD_KEY);
  try {
    return db
      .prepare<{ sha256: string }>('SELECT sha256 FROM blobs')
      .all()
      .map((r) => r.sha256);
  } finally {
    db.close();
  }
}

/** The zoom of the map, from the longitude span it reports (512 px tiles); the e2e reads it instead of the canvas. */
export async function mapZoom(page: Page): Promise<number> {
  const map = page.getByTestId('map');
  const span = Number(await map.getAttribute('data-span'));
  const box = await map.boundingBox();
  if (box === null || !(span > 0)) throw new Error('the map reports no span');
  return Math.log2((360 * box.width) / (512 * span));
}

/** Web-Mercator pixels of a position at `zoom` (512 px tiles, as MapLibre). */
export function toPixels([lng, lat]: readonly number[], zoom: number): [number, number] {
  const world = 512 * 2 ** zoom;
  const rad = ((lat ?? 0) * Math.PI) / 180;
  return [
    (((lng ?? 0) + 180) / 360) * world,
    (0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI)) * world,
  ];
}

/**
 * True when the stored ring/line has a vertex for each tapped screen position (within `tolerance` px) and no other.
 * Only offsets count (the map centre is not known to the spec), so vertex `0` of both lists is the anchor; the order
 * of the stored ring may differ (core.geo rewinds), so vertices are matched by distance.
 */
export function sameShape(
  stored: readonly (readonly number[])[],
  taps: readonly (readonly [number, number])[],
  zoom: number,
  tolerance = 3,
): boolean {
  const px = stored.map((p) => toPixels(p, zoom));
  const anchor = taps[0];
  if (anchor === undefined || px.length !== taps.length) return false;
  return px.some(([ax, ay]) =>
    taps.every(([tx, ty]) =>
      px.some(([sx, sy]) => Math.hypot(sx - ax - (tx - anchor[0]), sy - ay - (ty - anchor[1])) <= tolerance),
    ),
  );
}
