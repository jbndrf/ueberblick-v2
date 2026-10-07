import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createGeo,
  decodePage,
  formApi,
  PLAN_MAX_RULE_DEPTH,
  SYNC_PROTOCOL_VERSION,
  type Actor,
  type FeatureId,
  type Key,
  type RunId,
} from '@ueberblick/core';
import {
  base32Decode,
  createStore,
  loadConfig,
  createLogger,
  openControlDb,
  openProjectDb,
  totpAt,
  versionCacheFor,
  type Db,
} from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR, E2E_PORT } from '../playwright.config';
import { rosterToken } from './seed';
import { goldenFile } from './golden';

/** WP-106: the sync endpoint and the doorbell over the real process, with writes from a second process. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const KEY = 'syncstadt';
const vera: Actor = { id: 'vera', kind: 'participant', roles: ['verwaltung' as Key] };

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

let ctx: APIRequestContext;
let db: Db;
let write: (n: number) => void;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, KEY]).status).toBe(0);
  const created = admin(['create-admin', 'sync@example.org']);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', 'sync@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'sync@example.org', KEY, 'verwaltung']).status).toBe(0);
  admin(['publish-template', TEMPLATE]); // idempotent: another spec may have published it
  ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'sync@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: parse(readFileSync(TEMPLATE, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });

  // A second process writes runs into the project database the server reads (WAL).
  db = openProjectDb(E2E_DATA_DIR, KEY);
  const config = loadConfig(db);
  if (!config) throw new Error('nothing deployed');
  let n = 0;
  const store = createStore(db, {
    clock: { now: () => new Date().toISOString() },
    log: createLogger({ sink: () => undefined, now: () => Date.now() }),
    ids: {
      runId: () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId,
      featureId: () => `00000000-0000-7000-9000-${String(++n).padStart(12, '0')}` as FeatureId,
    },
    geo: createGeo(),
    limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
    config: (v) => (v === 1 ? config : undefined),
    versions: versionCacheFor(db),
    form: formApi,
  });
  write = (i) => {
    const r = store.submit({
      id: `00000000-0000-7000-a000-${String(i).padStart(12, '0')}` as RunId,
      task: 'erfassen' as Key,
      actor: vera,
      configVersion: 1,
      input: { vitalitaet: 'v2', geometrie: { type: 'Point', coordinates: [7.1 + i / 1000, 50.7] } },
    });
    if (r.outcome !== 'accepted') throw new Error(`${r.refusal.code}: ${r.refusal.message}`);
  };
});
test.afterAll(async () => {
  await ctx.dispose();
  db.close();
});

const pull = async (query: string) => {
  const res = await ctx.get(`/api/p/${KEY}/sync?${query}`);
  expect(res.status()).toBe(200);
  return decodePage((await res.json()) as unknown);
};

test('anonymous is 401, an unknown project 404, a participant of another project 403', async ({
  request,
  playwright,
  baseURL,
}) => {
  expect((await request.get(`/api/p/${KEY}/sync?since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`)).status()).toBe(
    401,
  );
  expect((await ctx.get(`/api/p/nowhere/sync?since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`)).status()).toBe(404);
  const control = openControlDb(`${E2E_DATA_DIR}/control.db`);
  const other = control.prepare<{ key: string }>('SELECT key FROM projects WHERE key <> ? LIMIT 1').get(KEY);
  control.close();
  const token = rosterToken(E2E_DATA_DIR, other?.key as string, 'p-sync');
  const p = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await p.post('/api/auth/exchange', { data: { token } });
  expect((await p.get(`/api/p/${KEY}/sync?since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`)).status()).toBe(403);
  await p.dispose();
});

test('a wrong protocol version is a typed 409 and a malformed query a 400', async () => {
  const v = await ctx.get(`/api/p/${KEY}/sync?since=0&scope=&v=99`);
  expect(v.status()).toBe(409);
  expect(await v.json()).toMatchObject({ code: 'version_mismatch' });
  expect((await ctx.get(`/api/p/${KEY}/sync?since=abc&scope=&v=${SYNC_PROTOCOL_VERSION}`)).status()).toBe(
    400,
  );
});

test('snapshot, then a delta of a run written by another process, then an empty delta', async () => {
  for (const i of [1, 2, 3]) write(i);
  const snap = await pull(`since=0&scope=&v=${SYNC_PROTOCOL_VERSION}&limit=2`);
  expect(snap.header).toMatchObject({ kind: 'snapshot', more: true });
  expect(snap.features).toHaveLength(2);
  const rest = await pull(
    `since=0&scope=${snap.header.scopeFingerprint}&v=${SYNC_PROTOCOL_VERSION}&limit=2&after=${snap.header.cursor}&pin=${snap.header.head}`,
  );
  expect(rest.features).toHaveLength(1);
  expect(rest.header.more).toBe(false);
  const scope = rest.header.scopeFingerprint;
  const head = rest.header.head;

  expect((await pull(`since=${head}&scope=${scope}&v=${SYNC_PROTOCOL_VERSION}`)).features).toEqual([]);
  write(4);
  const delta = await pull(`since=${head}&scope=${scope}&v=${SYNC_PROTOCOL_VERSION}`);
  expect(delta.header.kind).toBe('delta');
  expect(delta.features).toHaveLength(1);
  expect(delta.header.cursor).toBeGreaterThan(head);
  expect(
    (await pull(`since=${delta.header.cursor}&scope=${scope}&v=${SYNC_PROTOCOL_VERSION}`)).features,
  ).toEqual([]);
  // a stale fingerprint makes the device re-snapshot
  const stale = await pull(`since=${head}&scope=stale&v=${SYNC_PROTOCOL_VERSION}`);
  expect(stale.features).toEqual([]);
  expect(stale.header.scopeFingerprint).toBe(scope);
});

test('the doorbell announces a commit of another process as a seq range, and nothing else', async () => {
  const cookie = (await ctx.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const abort = new AbortController();
  const res = await fetch(`http://localhost:${E2E_PORT}/api/p/${KEY}/sync/events`, {
    headers: { cookie },
    signal: abort.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  expect(decoder.decode((await reader.read()).value)).toContain('event: hello');
  write(5);
  let text = '';
  const deadline = Date.now() + 8000;
  while (!text.includes('event: seq') && Date.now() < deadline)
    text += decoder.decode((await reader.read()).value);
  abort.abort();
  const data = JSON.parse(/data: (\{.*\})/.exec(text)?.[1] ?? '{}') as Record<string, number>;
  expect(Object.keys(data).sort()).toEqual(['from', 'head', 'to']);
  expect(data['to']).toBeGreaterThanOrEqual(data['from'] as number);
});
