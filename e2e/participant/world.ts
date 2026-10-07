/** The world the participant e2e runs in: one project with the golden tree cadastre, one participant, one tree. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Playwright } from '@playwright/test';
import { createAuth, importParticipant, openControlDb, openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { seedControl, type Seeded } from '../../apps/web/e2e/seed';
import { seedMapWorld } from './map-world';
import { PARTICIPANT_DATA_DIR } from './playwright.config';
import { embedRefs } from '../../scripts/embed-refs.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PROJECT = 'musterstadt';
export const PARTICIPANT = 'participant-1';
/** A second project for the map test: the same template with a drawable (inline) layer style, see `map-world.ts`. */
export const MAP_PROJECT = 'karte';
export const TEMPLATE = fileURLToPath(
  new URL('../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
);
export const TREE_RUN = '00000000-0000-7000-8000-000000000001';

export interface World {
  readonly seeded: Seeded;
}

/** Creates the project and the admin, deploys the template, the participant (on the roster, with a role, via seedControl) and records one tree. */
export async function seedWorld(playwright: Playwright, baseURL: string): Promise<World | undefined> {
  // A failed test restarts the worker and runs `beforeAll` again on the same server: the world is already there.
  if (existsSync(`${PARTICIPANT_DATA_DIR}/control.db`)) {
    const control = openControlDb(`${PARTICIPANT_DATA_DIR}/control.db`);
    const there = control.prepare('SELECT 1 AS x FROM projects WHERE key = ?').get(PROJECT) !== undefined;
    control.close();
    if (there) return undefined;
  }
  const seeded = await seedControl(PARTICIPANT_DATA_DIR, [PROJECT, MAP_PROJECT]);

  const admin = await playwright.request.newContext({ baseURL });
  const login = await admin.post('/api/auth/login', {
    data: { email: seeded.email, password: seeded.password, totp: seeded.totp() },
  });
  if (login.status() !== 200) throw new Error(`admin login failed: ${login.status()}`);
  // the golden map view has no camera; the list shows the features of the map extent, so look at the seeded tree
  const file = embedRefs(parse(readFileSync(TEMPLATE, 'utf8')), ROOT) as {
    views: Record<string, { camera?: unknown }>;
  };
  (file.views['karte'] as { camera?: unknown }).camera = { center: [7.1, 50.7], zoom: 15 };
  const deploy = await admin.post(`/api/admin/p/${PROJECT}/deploy`, { data: file });
  if (!((await deploy.json()) as { ok?: boolean }).ok) throw new Error('deploy failed');
  await seedMapWorld(playwright, baseURL, admin);
  await admin.dispose();

  const api = await playwright.request.newContext({ baseURL });
  await signInApi(api, seeded.spareToken);
  const run = await api.post(`/api/p/${PROJECT}/runs`, {
    data: {
      id: TREE_RUN,
      task: 'erfassen',
      configVersion: 1,
      input: {
        geometrie: { type: 'Point', coordinates: [7.1, 50.7] },
        vitalitaet: 'v2',
      },
    },
  });
  if (run.status() !== 200) throw new Error(`seeding the tree failed: ${run.status()} ${await run.text()}`);
  await api.dispose();
  return { seeded };
}

export async function signInApi(api: APIRequestContext, token: string): Promise<void> {
  const r = await api.post('/api/auth/exchange', { data: { token } });
  if (r.status() !== 200) throw new Error(`QR exchange failed: ${r.status()}`);
}

/** A fresh one-time QR token for the participant: what a printed QR code carries. */
export function issueToken(): string {
  const control = openControlDb(`${PARTICIPANT_DATA_DIR}/control.db`);
  try {
    const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
    return auth.issueCredential(`id-${PROJECT}`, PARTICIPANT).token;
  } finally {
    control.close();
  }
}

/** A token of a second participant on the roster (added when missing): for the takeover on a shared phone. */
export function issueTokenOfOther(): string {
  const project = openProjectDb(PARTICIPANT_DATA_DIR, PROJECT);
  // an id that is there already answers `participant_exists`: the roster has the second participant either way
  importParticipant(
    { db: project, now: () => new Date() },
    { id: 'participant-2', name: 'Ben', roles: ['kontrolle'] },
  );
  project.close();
  const control = openControlDb(`${PARTICIPANT_DATA_DIR}/control.db`);
  try {
    const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
    return auth.issueCredential(`id-${PROJECT}`, 'participant-2').token;
  } finally {
    control.close();
  }
}

/** The link a QR code opens: the same `/login?token=…` the sign-in page reads. */
export const qrLink = (token: string): string => `/login?token=${encodeURIComponent(token)}`;

export function setRoles(roles: readonly string[]): void {
  const project = openProjectDb(PARTICIPANT_DATA_DIR, PROJECT);
  try {
    project.prepare('UPDATE participants SET roles = ? WHERE id = ?').run(JSON.stringify(roles), PARTICIPANT);
  } finally {
    project.close();
  }
}

export interface ServerRun {
  readonly task: string;
  readonly outcome: string;
  readonly refusal_code: string | null;
}

/** What the server recorded for a task, newest last. */
export function serverRuns(task: string, projectKey: string = PROJECT): ServerRun[] {
  const project = openProjectDb(PARTICIPANT_DATA_DIR, projectKey);
  try {
    return project
      .prepare<ServerRun>('SELECT task, outcome, refusal_code FROM runs WHERE task = ? ORDER BY received_at')
      .all(task);
  } finally {
    project.close();
  }
}
