// `seed <fixture>`: a fresh project from fixtures/golden/projects/<fixture>.yaml, served by the built web
// app (npm run build -w @ueberblick/web) on a random local port, with the browser already signed in.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { adminLogin, deployOverlay } from './admin-client.mjs';
import { embedRefs } from '../embed-refs.mjs';
import { ensureBuilt } from '../ops/web-build.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUILD = join(ROOT, 'apps/web/build/index.js');

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export async function waitHealthy(base, child, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('the web app exited before it became healthy');
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not listening yet: poll again */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the web app did not become healthy in time');
}

/** Stops the app of an earlier seed, if any. */
export function stopApp(s) {
  s.app?.kill();
  s.app = undefined;
}

export async function seed(s, fixture) {
  const overlayFile = join(ROOT, 'fixtures/golden/projects', `${fixture}.yaml`);
  if (!existsSync(overlayFile)) throw new Error(`no fixture ${fixture} in fixtures/golden/projects`);
  await ensureBuilt();
  stopApp(s);
  s.seedCount = (s.seedCount ?? 0) + 1;
  const dataDir = join(s.runDir, `data-${s.seedCount}`);
  const made = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--import',
      join(ROOT, 'scripts/backup/register.mjs'),
      join(ROOT, 'scripts/ui/seed-run.ts'),
      dataDir,
      fixture,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (made.status !== 0) throw new Error(`seeding failed: ${made.stderr.trim().split('\n').pop()}`);
  const info = JSON.parse(made.stdout.trim().split('\n').pop());

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  s.app = spawn(process.execPath, [BUILD], {
    cwd: join(ROOT, 'apps/web'),
    stdio: ['ignore', openSync(join(s.runDir, 'app.log'), 'a'), 'inherit'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_URL: base,
      DATA_DIR: dataDir,
      UEBERBLICK_INSECURE_COOKIES: '1',
    },
  });
  await waitHealthy(base, s.app);
  const cookies = await adminLogin(base, info);
  await deployOverlay(
    base,
    cookies,
    info.key,
    embedRefs(parse(readFileSync(overlayFile, 'utf8')), ROOT),
    fixture,
  );
  await s.page.context().addCookies(cookies);
  return {
    text: `seeded ${fixture}: ${base} (project ${info.key}; signed in as ${info.email}, password ${info.password})`,
    data: { url: base, key: info.key, email: info.email, password: info.password },
  };
}
