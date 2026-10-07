import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { goldenData, goldenFile } from '../golden';
import { rosterToken } from '../seed';

/**
 * WP-828: the world of the bind-field journeys. The golden tree cadastre 1.0.0 with the test fixture
 * `projects/musterstadt-bind-field.yaml` (task `flaeche_pruefen`: a form field `area.name` of the bound Fläche,
 * edited from a tree), one area and one tree inside it. No demo template is changed.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const BIND_KEY = 'bindform';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const CENTER: readonly [number, number] = [10.4515, 51.1657];
export const AREA_NAME = 'Stadtpark';
const R = 0.01;
const ring = [
  [CENTER[0] - R, CENTER[1] - R],
  [CENTER[0] + R, CENTER[1] - R],
  [CENTER[0] + R, CENTER[1] + R],
  [CENTER[0] - R, CENTER[1] + R],
  [CENTER[0] - R, CENTER[1] - R],
];

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout + r.stderr };
}

async function send(api: APIRequestContext, id: string, task: string, input: unknown): Promise<void> {
  const r = await api.post(`/api/p/${BIND_KEY}/runs`, { data: { id, task, configVersion: 1, input } });
  expect(r.status(), await r.text()).toBe(200);
}

/** A fresh sign-in token of a participant with the role `kontrolle` (the preferences and queue follow the person). */
export const bindToken = (id: string): string => rosterToken(E2E_DATA_DIR, BIND_KEY, id, ['kontrolle']);

/** Creates the project, deploys cadastre plus bind overlay, records one area and one tree inside it. */
export async function seedBindWorld(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
): Promise<void> {
  if (admin(['create-project', BIND_KEY, BIND_KEY]).status !== 0) return; // a restarted worker finds the world there
  const email = 'bindreise@example.org';
  const created = admin(['create-admin', email]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', email, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', email, BIND_KEY, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/baumkataster/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${BIND_KEY}/deploy`, {
    data: goldenData('projects/musterstadt-bind-field.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
  const office = await playwright.request.newContext({ baseURL });
  await office.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, BIND_KEY, 'p-office', ['verwaltung']) },
  });
  await send(office, '00000000-0000-7000-8000-0000000828a1', 'flaeche_anlegen', {
    name: AREA_NAME,
    geometrie: { type: 'Polygon', coordinates: [ring] },
  });
  await office.dispose();
  const field = await playwright.request.newContext({ baseURL });
  await field.post('/api/auth/exchange', { data: { token: bindToken('p-seed') } });
  await send(field, '00000000-0000-7000-8000-0000000828b1', 'erfassen', {
    geometrie: { type: 'Point', coordinates: [CENTER[0] + 0.002, CENTER[1] + 0.002] },
    vitalitaet: 'v2',
  });
  await field.dispose();
}

/** The stored name of the one area, as the server's current state holds it. */
export function areaName(): unknown {
  const db = openProjectDb(E2E_DATA_DIR, BIND_KEY);
  try {
    const row = db
      .prepare<{ properties: string }>("SELECT properties FROM features WHERE type = 'flaeche' LIMIT 1")
      .get();
    return (JSON.parse(row?.properties ?? '{}') as Record<string, unknown>).name;
  } finally {
    db.close();
  }
}

/** How many runs of `task` the server accepted. */
export function acceptedBindRuns(task: string): number {
  const db = openProjectDb(E2E_DATA_DIR, BIND_KEY);
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
