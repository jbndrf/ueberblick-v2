/**
 * Budget (docs/12 "Server idle RSS", WP-1007/1008): the built server with 5 deployed projects, idle, <= 120 MB resident.
 * Starts `apps/web/build/index.js` on a free port in a scratch data dir, deploys the golden template 5 times through the
 * admin API, lets it settle and reads VmRSS from /proc (Linux). Needs the web build: without it (or off Linux) the
 * bench says so and reports nothing. The apps/web e2e spec `rss.spec.ts` asserts the same limit in the e2e run.
 * Run: npm run bench -- server-rss   (after npm run build -w @ueberblick/web)
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docBudget, report } from '../harness/budget.mjs';
import { isStale, BUILD_COMMAND, ROOT } from '../../scripts/ops/web-build.mjs';
import { scopedTmp } from '../../scripts/ops/vitest-scoped.mjs';
import { seedControl } from '../../apps/web/e2e/seed';
import { goldenData } from '../../apps/web/e2e/golden';

const WEB = join(ROOT, 'apps/web');
const READY_MS = 60_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, 'localhost', () => {
      const a = srv.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

const usable = process.platform === 'linux' && !isStale();
if (!usable) console.warn(`server-rss bench skipped: Linux and a current web build needed (${BUILD_COMMAND})`);

describe.skipIf(!usable)('bench: server idle RSS', () => {
  it('idle RSS with 5 deployed projects is <= 120 MB', async () => {
    const tmp = scopedTmp('bench-rss-');
    const dir = join(tmp.dir, 'data');
    const keys = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const seeded = await seedControl(dir, keys);
    const port = await freePort();
    const base = `http://localhost:${port}`;
    const child = spawn(process.execPath, [join(WEB, 'build/index.js')], {
      cwd: WEB,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: 'localhost',
        PUBLIC_URL: base,
        DATA_DIR: dir,
        UEBERBLICK_INSECURE_COOKIES: '1',
      },
      stdio: 'ignore',
    });
    try {
      const deadline = Date.now() + READY_MS;
      let ready = false;
      while (!ready && Date.now() < deadline) {
        try {
          ready = (await fetch(`${base}/api/health`)).ok;
        } catch {
          // not listening yet
        }
        if (!ready) await new Promise((r) => setTimeout(r, 100));
      }
      expect(ready).toBe(true);
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: seeded.email, password: seeded.password, totp: seeded.totp() }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      const file = goldenData('templates/baumkataster/1.0.0.yaml');
      for (const key of keys) {
        const r = await fetch(`${base}/api/admin/p/${key}/deploy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify(file),
        });
        expect(((await r.json()) as { ok: boolean }).ok).toBe(true);
      }
      await new Promise((r) => setTimeout(r, 2000)); // settle
      const kb = Number(/VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${child.pid}/status`, 'utf8'))?.[1]);
      const mb = kb / 1024;
      console.info(`server idle RSS with ${keys.length} projects: ${mb.toFixed(1)} MB`);
      report(docBudget('server-idle-rss'), Number(mb.toFixed(1)));
    } finally {
      child.kill();
      tmp.remove();
    }
  }, 120_000);
});
