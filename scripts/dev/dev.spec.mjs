// WP-949: `npm run dev` against a temp data dir on free ports, in http and in https mode (self-signed certificate).
// One seed takes about 45 s (two vite starts, the deploy of three projects, sample data), so this spec is NOT part of
// `npm run check`: it runs with `npm run test:dev` (RUN_DEV_SPEC=1) and is skipped, with a message, otherwise.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { freePort } from '../ui/seed.mjs';

// the https mode is self-signed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEV = join(ROOT, 'scripts/dev/dev.mjs');
const enabled = process.env.RUN_DEV_SPEC === '1';
if (!enabled) console.warn('dev.spec skipped: it takes minutes (run npm run test:dev)');
const SLOW = 300_000;
const PAGES = ['/api/health', '/admin/login', '/', '/login', '/map'];

const dir = mkdtempSync(join(tmpdir(), 'ub-dev-'));
const running = [];
afterAll(async () => {
  for (const child of running.filter((c) => c.exitCode === null)) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGINT');
    await gone;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** Starts `npm run dev` (the script) and resolves when it printed DEV READY. */
async function start(port, ...flags) {
  const child = spawn(
    process.execPath,
    [DEV, '--port', String(port), '--host', '127.0.0.1', '--dir', dir, ...flags],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: specEnv({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), // the https mode is self-signed
    },
  );
  running.push(child);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => out.includes('DEV READY') && (clearInterval(timer), resolve()), 100);
    void exited.then((code) => (clearInterval(timer), reject(new Error(`dev exited ${code}:\n${out}`))));
  });
  return { child, exited, output: () => out };
}

/** Ctrl-C: the script stops vite by its pid and exits 0. */
async function stop(run) {
  run.child.kill('SIGINT');
  expect(await run.exited).toBe(0);
}

const count = (file, sql) => {
  const d = new DatabaseSync(join(dir, file), { readOnly: true });
  try {
    return d.prepare(sql).get();
  } finally {
    d.close();
  }
};
const state = () => ({
  marker: readFileSync(join(dir, '.dev-seeded'), 'utf8'),
  admin: count('control.db', 'SELECT id, mfa FROM accounts LIMIT 1'),
  features: count('project-musterstadt_baeume.db', 'SELECT COUNT(*) AS n FROM features').n,
});

async function expectPagesOk(base) {
  for (const path of PAGES) {
    const r = await fetch(`${base}${path}`, { redirect: 'manual' });
    expect(r.status, `${base}${path}`).toBe(200);
  }
}

describe.skipIf(!enabled)('npm run dev', () => {
  const seen = {};

  it(
    'http mode: a fresh dir is seeded, every route answers 200, the admin has no TOTP',
    async () => {
      const port = await freePort();
      const run = await start(port, '--http');
      await expectPagesOk(`http://127.0.0.1:${port}`);
      seen.first = state();
      expect(seen.first.admin.mfa).toBeNull();
      expect(seen.first.features).toBeGreaterThanOrEqual(20);
      // sign-in with e-mail and password only: no TOTP code in the request (ADMIN_TOTP is off by default, WP-942)
      const creds = JSON.parse(seen.first.marker);
      const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: creds.email, password: creds.password }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.getSetCookie()[0].split(';')[0];
      const me = await (await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { cookie } })).json();
      expect(me.principal.kind).toBe('admin');
      expect(run.output()).toContain('/admin/login');
      expect(run.output()).toContain('/login?token=');
      await stop(run);
    },
    SLOW,
  );

  it(
    'https mode: a second start keeps the data (no reseed) and answers 200 with the self-signed certificate',
    async () => {
      const port = await freePort();
      const run = await start(port);
      expect(run.output()).toContain('Reusing');
      await expectPagesOk(`https://127.0.0.1:${port}`);
      expect(state()).toEqual(seen.first);
      await stop(run);
    },
    SLOW,
  );

  it(
    '--reset wipes and reseeds (a new admin account)',
    async () => {
      const port = await freePort();
      const run = await start(port, '--http', '--reset');
      const after = state();
      expect(after.admin.id).not.toBe(seen.first.admin.id);
      expect(after.features).toBe(seen.first.features);
      await stop(run);
    },
    SLOW,
  );
});
