import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { decodePage, SYNC_PROTOCOL_VERSION } from '@ueberblick/core';
import { base32Decode, totpAt } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../playwright.config';
import { rosterToken } from './seed';
import { goldenFile } from './golden';

/**
 * WP-137: the runtime wiring over the real built process. A run rings the doorbell of a second session at once, and
 * an `elapsed` rule fires through the timers loop (beat: TIMERS_INTERVAL_S, default 30 s) and reaches a
 * device through sync.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const KEY = 'wirestadt';

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

const uuid = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** The golden template with an `erfassen` that makes a tree due yesterday, so its elapsed rule is due at once. */
function dueTemplate(): unknown {
  const file = parse(readFileSync(TEMPLATE, 'utf8')) as {
    tasks: { erfassen: { then: { set: Record<string, string> }[] } };
    types: { baum: { permissions: { write: Record<string, string[]> } } };
  };
  const set = file.tasks.erfassen.then[0]?.set;
  if (set) set['faellig_am'] = 'today() - days(1)';
  file.types.baum.permissions.write['faellig_am'] = ['kontrolle', 'verwaltung'];
  return file;
}

let ctx: APIRequestContext;
let cookie = '';

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, KEY]).status).toBe(0);
  const created = admin(['create-admin', 'wire@example.org']);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', 'wire@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'wire@example.org', KEY, 'verwaltung']).status).toBe(0);
  ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'wire@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, { data: dueTemplate() });
  expect(await deploy.json()).toMatchObject({ ok: true });

  // a second session: a participant of the project, over plain fetch so its event stream can be read chunk by chunk
  const token = rosterToken(E2E_DATA_DIR, KEY, 'p-wire', ['kontrolle']);
  const res = await fetch(`${baseURL}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  expect(res.status).toBe(200);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toContain('ub_session_participant=');
});
test.afterAll(async () => ctx.dispose());

const baumart = (n: number, name: string) => ({
  id: uuid(n),
  task: 'baumart_anlegen',
  configVersion: 1,
  input: { name_de: name },
});

test('a submitted run rings a second session (the doorbell, not the 2 s head check)', async ({ baseURL }) => {
  const abort = new AbortController();
  const res = await fetch(`${baseURL}/api/p/${KEY}/sync/events`, {
    headers: { cookie },
    signal: abort.signal,
  });
  expect(res.status).toBe(200);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  expect(decoder.decode((await reader.read()).value)).toContain('event: hello');

  const posted = await ctx.post(`/api/p/${KEY}/runs`, { data: baumart(1, 'Doorbell') });
  expect(posted.status()).toBe(200);
  const heard = decoder.decode((await reader.read()).value);
  expect(heard).toContain('event: seq');
  abort.abort();
});

test('an elapsed rule fires through the timers loop and its effect reaches sync', async () => {
  test.setTimeout(90_000);
  const posted = await ctx.post(`/api/p/${KEY}/runs`, {
    data: {
      id: uuid(2),
      task: 'erfassen',
      configVersion: 1,
      input: { geometrie: { type: 'Point', coordinates: [7.1, 50.7] }, vitalitaet: 'v2' },
    },
  });
  expect(await posted.json()).toMatchObject({ outcome: 'accepted' });

  // the tree is due already; the next beat of the loop (at most one interval) turns it into a system run
  await expect
    .poll(
      async () => {
        const page = await ctx.get(`/api/p/${KEY}/sync?since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`);
        const trees = decodePage((await page.json()) as unknown).features.filter((f) => f.type === 'baum');
        return trees.map((t) => t.properties['kontrolle_faellig']);
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toEqual([true]);
});
