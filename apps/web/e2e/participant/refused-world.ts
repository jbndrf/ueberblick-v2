import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR, E2E_PORT } from '../../playwright.config';
import { goldenFile } from '../golden';
import { rosterToken } from '../seed';

/**
 * WP-752: the world of the refused-run journeys. One project with the golden tree cadastre 2.0.0, a worker-scoped
 * fixture that seeds it and signs an admin in, and the helpers that take a role away from a participant and give it
 * back through the admin API (a participant update, not a database write: R3).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const REFUSAL_KEY = 'refusalstadt';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
export const ROLE = 'kontrolle';

function admin(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout, err: r.stderr };
}

/** Creates the project (once), deploys the cadastre and returns an admin session that can change participants. */
async function seed(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
): Promise<APIRequestContext> {
  const fresh = admin(['create-project', 'refusalstadt', 'refusalstadt']).status === 0;
  const email = `refusal-${Date.now()}@example.org`; // a restarted worker signs in again with its own admin
  const created = admin(['create-admin', email]);
  const url = /otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '';
  const secret = base32Decode(new URL(url).searchParams.get('secret') ?? '');
  expect(admin(['confirm-totp', email, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', email, 'refusalstadt', 'verwaltung']).status).toBe(0);
  if (fresh)
    expect(admin(['publish-template', goldenFile('templates/baumkataster/2.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  if (fresh) {
    const deploy = await ctx.post('/api/admin/p/refusalstadt/deploy', {
      data: { schema: 'ueberblick/1', extends: 'baumkataster@2' },
    });
    expect(await deploy.json()).toMatchObject({ ok: true });
  }
  if (fresh) await seedTree(playwright, baseURL);
  return ctx;
}

/** One tree that the participants of the journeys add findings to (a feature that is on the server and on every device). */
async function seedTree(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string): Promise<void> {
  const field = await playwright.request.newContext({ baseURL });
  await field.post('/api/auth/exchange', {
    data: { token: rosterToken(E2E_DATA_DIR, 'refusalstadt', 'p-seed', [ROLE]) },
  });
  const r = await field.post('/api/p/refusalstadt/runs', {
    data: {
      id: '00000000-0000-7000-8000-0000000752a1',
      task: 'erfassen',
      configVersion: 1,
      input: { geometrie: { type: 'Point', coordinates: [10.4535, 51.1677] }, vitalitaet: 'v2' },
    },
  });
  expect(r.status(), await r.text()).toBe(200);
  await field.dispose();
}

export interface RefusalWorld {
  /** Signed-in admin of the project. */
  readonly office: APIRequestContext;
}

export const test = base.extend<object, { world: RefusalWorld }>({
  world: [
    async ({ playwright }, use) => {
      const office = await seed(playwright, `http://localhost:${E2E_PORT}`);
      await use({ office });
      await office.dispose();
    },
    { scope: 'worker' },
  ],
});

/** Sets the roles of a participant through the admin API (the same path the Teilnehmende page uses). */
export async function setRoles(world: RefusalWorld, participant: string, roles: string[]): Promise<void> {
  const r = await world.office.patch(`/api/admin/p/${REFUSAL_KEY}/participants/${participant}`, {
    data: { roles },
    headers: { 'sec-fetch-site': 'same-origin' }, // a change must come from the admin app (same origin)
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** A participant of its own (preferences and queue follow the person), signed in on the map. */
export async function signInAs(page: Page, participant: string): Promise<void> {
  const token = rosterToken(E2E_DATA_DIR, REFUSAL_KEY, participant, [ROLE]);
  await page.goto(`/login?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}

/** How many runs of `task` the server accepted. */
export function acceptedRuns(task: string): number {
  const db = openProjectDb(E2E_DATA_DIR, REFUSAL_KEY);
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
