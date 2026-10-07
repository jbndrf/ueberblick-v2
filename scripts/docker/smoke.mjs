// Docker smoke test (WP-940), not part of `npm run check`: `node scripts/docker/smoke.mjs [--keep]`.
// Builds the image, starts the compose file with an `.env` made from `.env.example` (plus PUBLIC_URL, APP_PORT and
// the first admin), waits for a healthy container and `/api/health` 200 through APP_PORT, writes a row into
// control.db, runs `docker compose down && up -d` and reads the row again (the data survives).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IMAGE = process.env.SMOKE_IMAGE ?? 'ueberblick:smoke';
const PROJECT = 'ueberblick-smoke';
const keep = process.argv.includes('--keep');

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0 && !opts.allowFail)
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  return r;
};
const log = (m) => process.stdout.write(`${m}\n`);

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

async function waitHealthy(base, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 200) return res.status;
    } catch {
      /* not listening yet: poll again */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${base}/api/health did not answer 200 in time`);
}

const dir = mkdtempSync(join(tmpdir(), 'ueberblick-smoke-'));
const port = await freePort();
const composeEnv = { ...process.env, UEBERBLICK_IMAGE: IMAGE };
const compose = (...args) =>
  run('docker', ['compose', '-p', PROJECT, '--project-directory', dir, ...args], { env: composeEnv });
const containerHealth = () => {
  const id = compose('ps', '-q', 'app').stdout.trim();
  return id === '' ? 'none' : run('docker', ['inspect', '-f', '{{.State.Health.Status}}', id]).stdout.trim();
};
const inApp = (script) => compose('exec', '-T', '-u', 'node', 'app', 'node', '-e', script).stdout.trim();

async function healthy() {
  const code = await waitHealthy(`http://localhost:${port}`);
  const until = Date.now() + 60_000;
  let status = containerHealth();
  while (status !== 'healthy' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    status = containerHealth();
  }
  if (status !== 'healthy') throw new Error(`container health is "${status}"`);
  log(`  /api/health -> ${code} via APP_PORT ${port}; container health: ${status}`);
  // WP-952: a page that runs the hooks (hooks.server imports sharp) and the external runtime modules themselves
  const login = await fetch(`http://localhost:${port}/admin/login`);
  if (login.status !== 200) throw new Error(`/admin/login answered ${login.status}`);
  log(`  /admin/login -> ${login.status}`);
  const mods = inApp(
    "Promise.all([import('sharp'),import('better-sqlite3')]).then(()=>console.log('sharp+better-sqlite3 import ok'))",
  );
  if (!mods.includes('import ok')) throw new Error(`runtime module import failed: ${mods}`);
  log(`  ${mods}`);
}

try {
  log('docker build');
  run('docker', ['build', '-t', IMAGE, ROOT], { stdio: 'inherit' });
  const size = Number(run('docker', ['image', 'inspect', '-f', '{{.Size}}', IMAGE]).stdout);
  log(`  image size: ${(size / 1024 / 1024).toFixed(0)} MB`);

  copyFileSync(join(ROOT, 'docker-compose.yaml'), join(dir, 'docker-compose.yaml'));
  const env = readFileSync(join(ROOT, '.env.example'), 'utf8')
    .replace(/^PUBLIC_URL=.*$/m, `PUBLIC_URL=http://localhost:${port}`)
    .replace(/^APP_PORT=.*$/m, `APP_PORT=${port}`)
    .replace(/^ADMIN_EMAIL=.*$/m, 'ADMIN_EMAIL=admin@example.org')
    .replace(/^ADMIN_PASSWORD=.*$/m, 'ADMIN_PASSWORD=smoke-test-password');
  writeFileSync(join(dir, '.env'), env);

  log('docker compose up -d');
  compose('up', '-d', '--no-build');
  await healthy();
  const uid = inApp('console.log(process.getuid())');
  log(`  exec -u node runs as uid ${uid}`);
  const appUid = compose(
    'exec',
    '-T',
    'app',
    'sh',
    '-c',
    "awk '/^Uid:/{print $2}' /proc/1/status",
  ).stdout.trim();
  if (appUid === '0') throw new Error('the app runs as root');
  log(`  the app (pid 1) runs as uid ${appUid}, not root`);
  inApp(
    "const D=require('better-sqlite3');const db=new D('/data/control.db');" +
      "db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run('smoke','smoke','Smoke','x')",
  );
  log('  wrote a project row into /data/control.db');

  log('docker compose down && up -d');
  compose('down');
  compose('up', '-d', '--no-build');
  await healthy();
  const name = inApp(
    "const D=require('better-sqlite3');console.log(new D('/data/control.db',{readonly:true}).prepare('SELECT name FROM projects WHERE key=?').get('smoke').name)",
  );
  if (name !== 'Smoke') throw new Error('the data did not survive the restart');
  log('  the project row survived: the data is in the volume');
  log('SMOKE OK');
} finally {
  if (keep) log(`kept: ${dir} (docker compose -p ${PROJECT} --project-directory ${dir} down)`);
  else {
    run('docker', ['compose', '-p', PROJECT, '--project-directory', dir, 'down', '-v'], {
      allowFail: true,
      env: composeEnv,
    });
    // the data folder belongs to the app user: remove it with the image's own root
    run('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${dir}:/t`, IMAGE, '-c', 'rm -rf /t/data'], {
      allowFail: true,
    });
    rmSync(dir, { recursive: true, force: true });
  }
}
