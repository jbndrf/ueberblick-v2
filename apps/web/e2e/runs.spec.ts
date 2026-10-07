import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { SYNC_PROTOCOL_VERSION } from '@ueberblick/core';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../playwright.config';
import { rosterToken } from './seed';
import { goldenFile } from './golden';

/** WP-105: the run endpoints over the real built process. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

const uuid = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const species = (n: number, name: string) => ({
  id: uuid(n),
  task: 'baumart_anlegen',
  configVersion: 1,
  input: { name_de: name },
});

let ctx: APIRequestContext;

test.beforeAll(async ({ playwright, baseURL }) => {
  for (const key of ['runstadt', 'fremdstadt']) expect(admin(['create-project', key, key]).status).toBe(0);
  const created = admin(['create-admin', 'runs@example.org']);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', 'runs@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'runs@example.org', 'runstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'runs@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/runstadt/deploy', {
    data: parse(readFileSync(TEMPLATE, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
});
test.afterAll(async () => ctx.dispose());

test('anonymous is 401 and a participant of another project is 403', async ({
  request,
  playwright,
  baseURL,
}) => {
  expect((await request.post('/api/p/runstadt/runs', { data: species(1, 'x') })).status()).toBe(401);
  const token = rosterToken(E2E_DATA_DIR, 'fremdstadt', 'p-1');
  const p = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await p.post('/api/auth/exchange', { data: { token } });
  const r = await p.post('/api/p/runstadt/runs', { data: species(2, 'x') });
  expect(r.status()).toBe(403);
  expect(await r.json()).toMatchObject({ error: { code: 'forbidden' } });
  await p.dispose();
});

test('a run is accepted, a repeat returns the ledger result, a bad body is a 400 with a path', async () => {
  const run = species(10, 'Linde');
  const r = await ctx.post('/api/p/runstadt/runs', { data: run });
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toMatchObject({ outcome: 'accepted', runId: run.id });
  expect(body.v).toBe(SYNC_PROTOCOL_VERSION);
  const again = await ctx.post('/api/p/runstadt/runs', { data: run });
  expect(await again.json()).toEqual(body);

  const bad = await ctx.post('/api/p/runstadt/runs', { data: { ...species(11, 'x'), task: 'Not A Key' } });
  expect(bad.status()).toBe(400);
  const issues = (await bad.json()).error.issues as { path: string }[];
  expect(issues.map((i) => i.path)).toContain('task');
  expect((await bad.json()).v).toBe(SYNC_PROTOCOL_VERSION);

  const gone = await ctx.post('/api/p/runstadt/runs', { data: { ...species(12, 'x'), configVersion: 9 } });
  expect(gone.status()).toBe(409);
  expect(await gone.json()).toMatchObject({
    v: SYNC_PROTOCOL_VERSION,
    outcome: 'review',
    configVersion: 9,
  });
});

test('a batch is atomic', async () => {
  const good = [species(20, 'Eiche'), species(21, 'Buche')];
  const refused = await ctx.post('/api/p/runstadt/runs/batch', {
    data: { runs: [...good, { ...species(22, 'x'), task: 'unbekannt' }] },
  });
  expect(refused.status()).toBe(422);
  expect(await refused.json()).toMatchObject({
    outcome: 'refused',
    index: 2,
    refusal: { code: 'unknown_task' },
  });
  // a refused batch keeps its ledger rows, so a retry with the same ids answers the same; new ids go through
  const again = await ctx.post('/api/p/runstadt/runs/batch', { data: { runs: good } });
  expect(again.status()).toBe(422);
  const fresh = [species(23, 'Eiche'), species(24, 'Buche')];
  const ok = await ctx.post('/api/p/runstadt/runs/batch', { data: { runs: fresh } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.results.map((x: { runId: string }) => x.runId)).toEqual(fresh.map((x) => x.id));
});

test('a participant with the role kontrolle runs a role-bound task; role changes and disabling apply at once', async ({
  playwright,
  baseURL,
}) => {
  const token = rosterToken(E2E_DATA_DIR, 'runstadt', 'anna', ['kontrolle']);
  const project = openProjectDb(E2E_DATA_DIR, 'runstadt');
  const p = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect((await p.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  const tree = (n: number) => ({
    id: uuid(n),
    task: 'erfassen',
    configVersion: 1,
    input: { geometrie: { type: 'Point', coordinates: [7.1 + n * 0.0001, 50.7] }, vitalitaet: 'v2' },
  });
  const ok = await p.post('/api/p/runstadt/runs', { data: tree(30) });
  expect(await ok.json()).toMatchObject({ outcome: 'accepted' });

  project.prepare('UPDATE participants SET roles = ? WHERE id = ?').run('["bauhof"]', 'anna');
  const refused = await p.post('/api/p/runstadt/runs', { data: tree(31) });
  expect(refused.status()).toBe(422);

  project.prepare('UPDATE participants SET roles = ? WHERE id = ?').run('["kontrolle"]', 'anna');
  expect((await p.post('/api/p/runstadt/runs', { data: tree(32) })).status()).toBe(200);

  project
    .prepare('UPDATE participants SET disabled_at = ? WHERE id = ?')
    .run(new Date().toISOString(), 'anna');
  expect((await p.post('/api/p/runstadt/runs', { data: tree(33) })).status()).toBe(401);
  project.close();
  await p.dispose();
});
