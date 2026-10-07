#!/usr/bin/env node
// `npm run demo [-- flags]`: builds the web app, seeds a demo data dir (three projects with sample data), serves it on
// 0.0.0.0 and prints everything needed to click through it. DEMO ONLY (docs/process/demo.md). Flags:
//   --port 4173  --host 0.0.0.0  --dir ~/ueberblick-demo  --reset  --no-build  --http (plain http, no certificate)
//   --totp   explain that the demo admin has no one-time code (TOTP is off)   --links  print fresh participant links and exit
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployOverlay } from '../ui/admin-client.mjs';
import { freePort, waitHealthy } from '../ui/seed.mjs';
import { handoutText, lanAddresses, WARNING } from './handout.mjs';
import { buildExists, ensureBuilt } from '../ops/web-build.mjs';
import { ensureCert, startFront } from './front.mjs';
import { demoOverlay } from './overlays.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUILD = join(ROOT, 'apps/web/build/index.js');
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'));
const MARKER = '.demo-seeded';
const BOOL = ['reset', 'no-build', 'totp', 'links', 'http'];

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const name = a.slice(2);
    if (BOOL.includes(name)) flags[name] = true;
    else if (['port', 'host', 'dir'].includes(name)) flags[name] = argv[++i];
    else throw new Error(`unknown flag ${a}`);
  }
  const port = Number(flags.port ?? 4173);
  return {
    port,
    host: flags.host ?? '0.0.0.0',
    dir: resolve(flags.dir ?? join(homedir(), 'ueberblick-demo')),
    reset: flags.reset === true,
    noBuild: flags['no-build'] === true,
    totp: flags.totp === true,
    links: flags.links === true,
    http: flags.http === true,
  };
}

/** One TypeScript step (scripts/demo/ctl.ts). Returns the last stdout line parsed as JSON. */
export function ctl(command, dir) {
  const r = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--import',
      join(ROOT, 'scripts/backup/register.mjs'),
      join(ROOT, 'scripts/demo/ctl.ts'),
      command,
      dir,
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`demo ${command} failed:\n${r.stderr.trim()}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startApp({ host, port, dir, secure = false }, logFile) {
  const log = openSync(logFile, 'a');
  return spawn(process.execPath, [BUILD], {
    cwd: join(ROOT, 'apps/web'),
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      // required by the config; the demo learns the real address from X-Forwarded-* (below)
      PUBLIC_URL: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
      DATA_DIR: dir,
      // demo only. Behind the door (front.mjs) the app learns the address and protocol the browser used from
      // X-Forwarded-*, so one server answers on every LAN address (no ORIGIN, which would pin it to one). Cookies are
      // Secure when the door speaks https, and plain with --http.
      HOST_HEADER: 'x-forwarded-host',
      PROTOCOL_HEADER: 'x-forwarded-proto',
      ...(secure ? {} : { UEBERBLICK_INSECURE_COOKIES: '1' }),
    },
  });
}

export async function stopApp(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(10_000).then(() => child.kill('SIGKILL'))]);
  await exited;
}

/**
 * A fresh data dir: control.db, the deploy through a short-lived loopback server, then the sample data as runs.
 * `npm run dev` (scripts/dev/dev.mjs) seeds through the same function (R1) and passes its own server start:
 * `start({ host, port, dir }, logFile)` returns a child process that answers /api/health. The admin has no TOTP.
 */
export async function seed(dir, start = startApp) {
  console.log(`Seeding ${dir} (three projects, sample data) ...`);
  mkdirSync(dir, { recursive: true });
  const { email, password } = ctl('seed', dir);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const app = start({ host: '127.0.0.1', port, dir }, join(dir, 'seed-server.log'));
  try {
    await waitHealthy(base, app, 90_000);
    const { name, value } = ctl('session', dir);
    const cookies = [{ name, value, url: base }];
    for (const p of plan.projects) {
      await deployOverlay(base, cookies, p.key, demoOverlay(ROOT, p.fixture), p.fixture);
    }
  } finally {
    await stopApp(app);
  }
  ctl('populate', dir);
  return { email, password };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.totp) {
    if (!existsSync(join(o.dir, MARKER)))
      throw new Error(`${o.dir} is not a demo data dir: run npm run demo first`);
    const state = ctl('totp', o.dir);
    if (state.enrolled === false) {
      console.error(
        'The demo admin has no one-time code: TOTP is off. Sign in with the e-mail and password from the handout.',
      );
      process.exitCode = 1;
      return;
    }
    if (state.waitMs > 0)
      console.error(`waiting ${Math.ceil(state.waitMs / 1000)} s until the server accepts the next code ...`);
    await sleep(state.waitMs + 200);
    console.log(state.code);
    return;
  }
  if (o.links) {
    for (const l of ctl('links', o.dir))
      console.log(`${l.project} ${l.name} (${l.roles}): /login?token=${encodeURIComponent(l.token)}`);
    return;
  }
  console.log(`WARNING: ${WARNING}\n`);
  if (o.noBuild) {
    if (!buildExists())
      throw new Error('--no-build, but the web app is not built: run npm run build -w @ueberblick/web');
  } else await ensureBuilt();
  if (o.reset) rmSync(o.dir, { recursive: true, force: true });
  if (!existsSync(join(o.dir, MARKER))) {
    if (existsSync(o.dir) && readdirSync(o.dir).length > 0)
      throw new Error(
        `${o.dir} is not empty and not a finished demo dir: use --reset to wipe it, or another --dir`,
      );
    const creds = await seed(o.dir);
    writeFileSync(join(o.dir, MARKER), `${JSON.stringify(creds)}\n`);
  } else console.log(`Reusing ${o.dir} (--reset wipes and reseeds it).`);

  const { email, password } = JSON.parse(readFileSync(join(o.dir, MARKER), 'utf8'));
  const links = ctl('links', o.dir);
  const appPort = await freePort();
  const app = startApp(
    { host: '127.0.0.1', port: appPort, dir: o.dir, secure: !o.http },
    join(o.dir, 'server.log'),
  );
  const base = `http://127.0.0.1:${appPort}`;
  let front;
  let stopping = false;
  const shutdown = async (code) => {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping the demo ...');
    front?.close();
    front?.closeAllConnections();
    await stopApp(app);
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  app.once(
    'exit',
    (code) =>
      void (
        !stopping &&
        (console.error(`the web app exited (${code}), see ${join(o.dir, 'server.log')}`), shutdown(1))
      ),
  );
  const addrs = lanAddresses();
  try {
    await waitHealthy(base, app, 90_000);
    front = await startFront({
      host: o.host,
      port: o.port,
      appPort,
      ...(o.http ? {} : { tls: ensureCert(o.dir, addrs) }),
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    await shutdown(1); // never leave the app running without its door
  }
  const text = handoutText({
    addrs,
    port: o.port,
    scheme: o.http ? 'http' : 'https',
    dir: o.dir,
    email,
    password,
    projects: plan.projects,
    links,
  });
  writeFileSync(join(o.dir, 'DEMO.md'), text);
  console.log(text);
  console.log(`DEMO READY (Ctrl-C stops it; handout also in ${join(o.dir, 'DEMO.md')})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
