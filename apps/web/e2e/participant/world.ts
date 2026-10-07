import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenFile } from '../golden';
import { rosterToken } from '../seed';

/**
 * The world of the participant journeys on the built app (WP-703): one project with the golden tree cadastre 2.0.0,
 * an area (Fläche) and a tree inside it, and a listener that turns every console error, page error and CSP
 * violation into a test failure.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const KEY = 'journeystadt';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
/** The map view of the golden template starts here (`map.start`). */
export const CENTER: readonly [number, number] = [10.4515, 51.1657];
const ring = (r: number): number[][] => [
  [CENTER[0] - r, CENTER[1] - r],
  [CENTER[0] + r, CENTER[1] - r],
  [CENTER[0] + r, CENTER[1] + r],
  [CENTER[0] - r, CENTER[1] + r],
  [CENTER[0] - r, CENTER[1] - r],
];

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

async function run(api: APIRequestContext, id: string, task: string, input: unknown): Promise<void> {
  const r = await api.post(`/api/p/${KEY}/runs`, { data: { id, task, configVersion: 1, input } });
  expect(r.status(), await r.text()).toBe(200);
}

/** Creates the project, deploys the cadastre, and records one area and one tree inside it. */
export async function seedWorld(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
): Promise<void> {
  admin(['create-project', KEY, KEY]);
  const created = admin(['create-admin', 'journey@example.org']);
  const url = /otpauth:\/\/\S+/.exec(created.out)?.[0];
  if (url !== undefined) {
    const secret = base32Decode(new URL(url).searchParams.get('secret') ?? '');
    expect(admin(['confirm-totp', 'journey@example.org', totpAt(secret, Date.now())]).status).toBe(0);
    expect(admin(['add-membership', 'journey@example.org', KEY, 'verwaltung']).status).toBe(0);
    expect(admin(['publish-template', goldenFile('templates/baumkataster/2.0.0.yaml')]).status).toBe(0);
    const ctx = await playwright.request.newContext({ baseURL });
    const login = await ctx.post('/api/auth/login', {
      data: { email: 'journey@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
    });
    expect(login.status()).toBe(200);
    const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
      data: { schema: 'ueberblick/1', extends: 'baumkataster@2' },
    });
    expect(await deploy.json()).toMatchObject({ ok: true });
    await ctx.dispose();
  }
  if (url === undefined) return; // a restarted worker finds the world there
  const office = await playwright.request.newContext({ baseURL });
  await office.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, KEY, 'p-office', ['verwaltung']) },
  });
  await run(office, '00000000-0000-7000-8000-0000000000a1', 'flaeche_anlegen', {
    name: 'Stadtpark',
    geometrie: { type: 'Polygon', coordinates: [ring(0.01)] },
  });
  await office.dispose();
  const field = await playwright.request.newContext({ baseURL });
  await field.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, KEY, 'p-field', ['kontrolle']) },
  });
  await run(field, '00000000-0000-7000-8000-0000000000b1', 'erfassen', {
    geometrie: { type: 'Point', coordinates: [CENTER[0] + 0.002, CENTER[1] + 0.002] },
    vitalitaet: 'v2',
  });
  await field.dispose();
}

/** A fresh sign-in link token of a field participant (role kontrolle). */
export const fieldToken = (id = 'p-field'): string => rosterToken(E2E_DATA_DIR, KEY, id, ['kontrolle']);

/** Console errors of resources that the offline e2e server cannot serve (map tiles, sprites, glyphs): by URL, never by text. */
const MAP_RESOURCE = /\/(tiles|sprites?|glyphs?|fonts)\/|\.(pbf|mvt|png|webp)(\?|$)/;
const allowed = new WeakMap<string[], RegExp[]>();

/**
 * Collects console errors, page errors and CSP violations. A failed map-resource load (404) is no error, judged by the
 * URL of the message. A test allows more only for its own phase with `allowErrors`; the pattern is applied when the
 * error arrives, so the returned array stays the one the listeners push to.
 */
export function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  const ok = (text: string): boolean => (allowed.get(problems) ?? []).some((re) => re.test(text));
  const push = (text: string): void => {
    if (!ok(text)) problems.push(text);
  };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location().url;
    if (/status of 404/.test(m.text()) && MAP_RESOURCE.test(url)) return;
    push(`console: ${m.text()} (${url})`);
  });
  page.on('pageerror', (e) => push(`pageerror: ${e.message}`));
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return problems;
}

/** Lets the errors of `problems` that match `pattern` pass from now on (used for the offline phase only). */
export function allowErrors(problems: string[], pattern: RegExp): void {
  allowed.set(problems, [...(allowed.get(problems) ?? []), pattern]);
}

/** How many runs of a task the server has accepted. */
export function serverRuns(task: string): number {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
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

/** Stored geometry of a feature as GeoJSON, as the server's current state (the fold) holds it. */
export type StoredGeometry = { type: string; coordinates: unknown };

/** The stored geometry of every live feature of a type, by id (read before a run to compare after it). */
export function geometriesOfType(type: string): Record<string, StoredGeometry> {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    const rows = db
      .prepare<{ id: string; geometry: string }>(
        "SELECT id, geometry FROM features WHERE type = ? AND lifecycle <> 'deleted' AND geometry IS NOT NULL",
      )
      .all(type);
    return Object.fromEntries(rows.map((r) => [r.id, JSON.parse(r.geometry) as StoredGeometry]));
  } finally {
    db.close();
  }
}

/** The feature that the latest accepted run of a task wrote its `geometrie` to, with the geometry the server stores for it. */
export function geometryOfLastRun(task: string): { featureId: string; geometry: StoredGeometry } | undefined {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    const row = db
      .prepare<{ feature_id: string; geometry: string | null }>(
        `SELECT o.feature_id AS feature_id, f.geometry AS geometry
           FROM runs r JOIN observations o ON o.run_id = r.id AND o.property = 'geometrie'
           JOIN features f ON f.id = o.feature_id
          WHERE r.task = ? AND r.outcome = 'accepted' ORDER BY r.seq DESC LIMIT 1`,
      )
      .get(task);
    if (row === undefined || row.geometry === null) return undefined;
    return { featureId: row.feature_id, geometry: JSON.parse(row.geometry) as StoredGeometry };
  } finally {
    db.close();
  }
}

/** Signs in with a fresh link and waits for the map shell. A test that changes personal preferences uses its own participant. */
export async function signIn(page: Page, participant = 'p-field'): Promise<void> {
  await page.goto(`/login?token=${encodeURIComponent(fieldToken(participant))}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}
