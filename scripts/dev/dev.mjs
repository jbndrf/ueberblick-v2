#!/usr/bin/env node
// `npm run dev [-- flags]`: the dev server of apps/web (vite dev --host) with seeded data (docs/process/dev.md).
// https with a self-signed certificate on every LAN address by default (a phone gets a secure context: service worker,
// Web Locks); `npm run dev:http` is plain http for desktop GIS clients that reject the certificate. Flags:
//   --http  --reset  --port 5173  --host 0.0.0.0  --dir <data dir>     env: DATA_DIR, DEV_RESET=1
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitHealthy } from '../ui/seed.mjs';
import { ctl, seed, stopApp } from '../demo/demo.mjs';
import { lanAddresses } from '../demo/handout.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB = join(ROOT, 'apps/web');
export const MARKER = '.dev-seeded';

export function parseArgs(argv, env = process.env) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const name = a.slice(2);
    if (['http', 'reset'].includes(name)) flags[name] = true;
    else if (['port', 'host', 'dir'].includes(name)) flags[name] = argv[++i];
    else throw new Error(`unknown flag ${a}`);
  }
  return {
    port: Number(flags.port ?? 5173),
    host: flags.host ?? '0.0.0.0',
    dir: resolve(flags.dir ?? env.DATA_DIR ?? join(ROOT, '.dev-data')),
    reset: flags.reset === true || env.DEV_RESET === '1',
    http: flags.http === true || env.DEV_HTTP === 'true',
  };
}

/**
 * Seeds `dir` unless it is already seeded. Returns the sign-in of the data dir and whether it was seeded now.
 * `reset` wipes it first. A non-empty dir without the marker is refused: it is not ours to wipe.
 */
export async function ensureSeeded(dir, { reset = false, start }) {
  if (reset) rmSync(dir, { recursive: true, force: true });
  const marker = join(dir, MARKER);
  if (existsSync(marker)) return { ...JSON.parse(readFileSync(marker, 'utf8')), seeded: false };
  if (existsSync(dir) && readdirSync(dir).length > 0)
    throw new Error(
      `${dir} is not empty and not a seeded dev data dir: use --reset to wipe it, or another --dir`,
    );
  const creds = await seed(dir, start);
  writeFileSync(marker, `${JSON.stringify(creds)}\n`);
  return { ...creds, seeded: true };
}

/** What the console shows once the server answers: where to open it, the admin sign-in, one link per participant. */
export function devText(h) {
  const base = `${h.scheme}://${h.addrs[0] ?? 'localhost'}:${h.port}`;
  const L = ['', `Open: ${[...h.addrs, 'localhost'].map((a) => `${h.scheme}://${a}:${h.port}/`).join('  ')}`];
  L.push(`Admin: ${base}/admin/login  e-mail ${h.email}  password "${h.password}"  (no one-time code)`);
  L.push('Participants (a link works once; more: npm run demo -- --links --dir <data dir>):');
  for (const l of h.links)
    L.push(`  ${l.project} ${l.name} (${l.roles}): ${base}/login?token=${encodeURIComponent(l.token)}`);
  if (h.scheme === 'https')
    L.push('The browser warns about the self-signed certificate once per device: Advanced, then continue.');
  return L.join('\n');
}

const viteBin = () =>
  join(dirname(createRequire(join(WEB, 'package.json')).resolve('vite/package.json')), 'bin/vite.js');

/** `vite dev` of apps/web as a child process (its pid is vite's own, so a stop reaches it). */
export function startVite({ host, port, dir, https = false }, logFile) {
  const out = logFile === undefined ? 'inherit' : openSync(logFile, 'a');
  const scheme = https ? 'https' : 'http';
  return spawn(process.execPath, [viteBin(), 'dev', '--host', host, '--port', String(port), '--strictPort'], {
    cwd: WEB,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      DATA_DIR: dir,
      // required by the config; dev learns the real address from the request
      PUBLIC_URL: `${scheme}://localhost:${port}`,
      TIMERS_INTERVAL_S: process.env.TIMERS_INTERVAL_S ?? '30',
      ...(https ? { DEV_HTTPS: '1' } : { UEBERBLICK_INSECURE_COOKIES: '1' }),
    },
  });
}

/** The Paraglide messages are generated files that the dev server imports (the build runs this as `prebuild`). */
function i18n() {
  return new Promise((res, rej) =>
    spawn('npm', ['run', 'i18n', '-w', '@ueberblick/web', '--silent'], { cwd: ROOT, stdio: 'inherit' }).once(
      'exit',
      (code) => (code === 0 ? res(undefined) : rej(new Error('npm run i18n failed'))),
    ),
  );
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  await i18n();
  const creds = await ensureSeeded(o.dir, { reset: o.reset, start: (s, log) => startVite(s, log) });
  if (!creds.seeded) console.log(`Reusing ${o.dir} (npm run dev -- --reset wipes and reseeds it).`);
  const links = ctl('links', o.dir);

  const app = startVite({ host: o.host, port: o.port, dir: o.dir, https: !o.http });
  let stopping = false;
  const shutdown = async (code) => {
    if (stopping) return;
    stopping = true;
    await stopApp(app);
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  app.once('exit', (code) => void (!stopping && (console.error(`vite exited (${code})`), shutdown(1))));
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the readiness probe talks to our own self-signed certificate
  const scheme = o.http ? 'http' : 'https';
  await waitHealthy(`${scheme}://127.0.0.1:${o.port}`, app, 120_000);
  console.log(devText({ addrs: lanAddresses(), port: o.port, scheme, dir: o.dir, ...creds, links }));
  console.log(`DEV READY in ${((Date.now() - t0) / 1000).toFixed(1)} s (Ctrl-C stops it; data in ${o.dir})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
