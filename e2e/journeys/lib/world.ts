/** The world the journeys run in: one project (musterstadt) with the golden tree cadastre, one participant, one admin. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type Page, type Playwright } from '@playwright/test';
import { createAuth, openControlDb, openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { seedControl, type Seeded } from '../../../apps/web/e2e/seed';
import { embedRefs } from '../../../scripts/embed-refs.mjs';
import { JOURNEYS_DATA_DIR } from '../playwright.config';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const PROJECT = 'musterstadt';
export const PARTICIPANT = 'participant-1';
export const TEMPLATE = fileURLToPath(
  new URL('../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
);
/** The admin `seedControl` creates. */
export const ADMIN = { email: 'admin@example.org', password: 'correct horse battery' } as const;

/**
 * Seeds the golden project once per data dir: project, admin, participant on the roster with the role "kontrolle",
 * the golden template deployed. Safe to call from every spec's `beforeAll` (a restarted worker finds it there).
 */
export async function seedJourneyWorld(playwright: Playwright, baseURL: string): Promise<Seeded | undefined> {
  if (existsSync(`${JOURNEYS_DATA_DIR}/control.db`)) {
    const control = openControlDb(`${JOURNEYS_DATA_DIR}/control.db`);
    const there = control.prepare('SELECT 1 AS x FROM projects WHERE key = ?').get(PROJECT) !== undefined;
    control.close();
    if (there) return undefined;
  }
  const seeded = await seedControl(JOURNEYS_DATA_DIR, [PROJECT]);
  const admin = await playwright.request.newContext({ baseURL });
  const login = await admin.post('/api/auth/login', {
    data: { email: seeded.email, password: seeded.password, totp: seeded.totp() },
  });
  if (login.status() !== 200) throw new Error(`admin login failed: ${login.status()}`);
  const file = embedRefs(parse(readFileSync(TEMPLATE, 'utf8')), ROOT);
  const deploy = await admin.post(`/api/admin/p/${PROJECT}/deploy`, { data: file });
  if (!((await deploy.json()) as { ok?: boolean }).ok) throw new Error('deploy failed');
  await admin.dispose();
  return seeded;
}

/** A fresh one-time QR token for the participant: what a printed QR code carries. */
export function issueToken(): string {
  const control = openControlDb(`${JOURNEYS_DATA_DIR}/control.db`);
  try {
    const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
    return auth.issueCredential(`id-${PROJECT}`, PARTICIPANT).token;
  } finally {
    control.close();
  }
}

/** The link a QR code opens: the same `/login?token=…` the sign-in page reads. */
export const qrLink = (token: string): string => `/login?token=${encodeURIComponent(token)}`;

/** Signs the API client in like a QR scan does. */
export async function signInApi(api: APIRequestContext, token: string): Promise<void> {
  const r = await api.post('/api/auth/exchange', { data: { token } });
  expect(r.status(), 'QR exchange').toBe(200);
}

/** Participant sign-in by QR link (0 taps). The page leaves /login for the participant app. */
export async function signInByLink(page: Page): Promise<void> {
  await page.goto(qrLink(issueToken()));
  await expect(page).not.toHaveURL(/\/login/);
}

/** Admin sign-in through v3's form at /admin/login. */
export async function adminSignIn(page: Page, opts: { remember?: boolean } = {}): Promise<void> {
  await page.goto('/admin/login');
  await page.getByRole('textbox', { name: 'E-Mail' }).fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.password);
  if (opts.remember === true)
    await page.getByRole('checkbox', { name: '30 Tage angemeldet bleiben' }).check();
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/admin\/projects/);
}

export interface ServerRun {
  readonly task: string;
  readonly outcome: string;
  readonly refusal_code: string | null;
}

/** What the server recorded for a task, newest last. */
export function serverRuns(task: string): ServerRun[] {
  const project = openProjectDb(JOURNEYS_DATA_DIR, PROJECT);
  try {
    return project
      .prepare<ServerRun>('SELECT task, outcome, refusal_code FROM runs WHERE task = ? ORDER BY received_at')
      .all(task);
  } finally {
    project.close();
  }
}
