import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { seedControl } from './seed';
import { goldenData } from './golden';

/** docs/12: server idle RSS <= 120 MB with 5 projects. */
const BUDGET_MB = 120;
/** The app directory, whatever the cwd of the runner (`npm run e2e` runs from the repo root). */
const WEB_DIR = fileURLToPath(new URL('..', import.meta.url));
const READY_DEADLINE_MS = 60_000;

/** A free port from the OS (listen on 0), so no suite shares a fixed one. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, 'localhost', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

test('idle RSS of the built server with 5 deployed projects stays within budget', async ({ playwright }) => {
  const dir = mkdtempSync(join(tmpdir(), 'ueberblick-e2e-rss-')); // per run: worktrees and runs must not share it (WP-1016)
  const keys = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const seeded = await seedControl(dir, keys);
  const PORT = await freePort();
  const child = spawn('node', [join(WEB_DIR, 'build/index.js')], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: 'localhost',
      PUBLIC_URL: `http://localhost:${PORT}`,
      DATA_DIR: dir,
      UEBERBLICK_INSECURE_COOKIES: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  let exited: number | null | undefined;
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  child.on('exit', (code) => {
    exited = code;
  });
  const lastLines = (): string => stderr.trim().split('\n').slice(-5).join(' | ') || '(no stderr)';
  try {
    const base = `http://localhost:${PORT}`;
    const deadline = Date.now() + READY_DEADLINE_MS;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      if (exited !== undefined)
        throw new Error(`server exited early (code ${exited}) on port ${PORT}: ${lastLines()}`);
      try {
        ready = (await fetch(`${base}/api/health`)).ok;
      } catch {
        // not listening yet
      }
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready)
      throw new Error(`server not ready on port ${PORT} after ${READY_DEADLINE_MS} ms: ${lastLines()}`);
    const ctx = await playwright.request.newContext({ baseURL: base });
    const login = await ctx.post('/api/auth/login', {
      data: { email: seeded.email, password: seeded.password, totp: seeded.totp() },
    });
    expect(login.status()).toBe(200);
    const file = goldenData('templates/baumkataster/1.0.0.yaml');
    for (const key of keys) {
      const r = await ctx.post(`/api/admin/p/${key}/deploy`, { data: file });
      expect((await r.json()).ok).toBe(true);
    }
    await ctx.dispose();
    await new Promise((r) => setTimeout(r, 2000)); // settle
    const status = readFileSync(`/proc/${child.pid}/status`, 'utf8');
    const kb = Number(/VmRSS:\s+(\d+) kB/.exec(status)?.[1]);
    const mb = kb / 1024;
    console.log(`idle RSS with ${keys.length} projects: ${mb.toFixed(1)} MB (budget ${BUDGET_MB} MB)`);
    expect(mb).toBeLessThanOrEqual(BUDGET_MB);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
