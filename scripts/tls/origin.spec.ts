// WP-954: adapter-node's origin comes from PUBLIC_URL in one place. The built-app cases need the web build
// (npm run build -w @ueberblick/web) and skip with a message without it, like demo.spec.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer, type AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { transportGate } from '../../apps/web/src/lib/server/tls/gate';
import { loadConfig } from '../../apps/web/src/lib/server/config/parse';
import { BUILD_COMMAND, isStale } from '../ops/web-build.mjs';
import { specEnv } from '../testing/spec-env.mjs';
import { loadTlsMaterial } from './cert.mjs';
import { startTlsFront } from './front.mjs';
import { originEnv } from './origin.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB = join(ROOT, 'apps/web');
const ENTRYPOINT = join(ROOT, 'scripts/docker/entrypoint.sh');
const built = !isStale();
if (!built)
  console.warn(`origin.spec built-app cases skipped: the web build is missing or stale (${BUILD_COMMAND})`);

describe('originEnv', () => {
  it('proxy mode: ORIGIN is the origin of PUBLIC_URL, trailing slash and all', () => {
    expect(originEnv({ PUBLIC_URL: 'https://ueberblick.example.org/' })).toEqual({
      ORIGIN: 'https://ueberblick.example.org',
    });
    expect(originEnv({ PUBLIC_URL: ' http://localhost:4173 ', HTTPS_MODE: 'proxy' })).toEqual({
      ORIGIN: 'http://localhost:4173',
    });
  });
  it('direct mode: no ORIGIN, the front-set headers instead', () => {
    expect(originEnv({ PUBLIC_URL: 'https://192.168.1.90:8443', HTTPS_MODE: 'direct' })).toEqual({
      PROTOCOL_HEADER: 'x-forwarded-proto',
      HOST_HEADER: 'x-forwarded-host',
    });
  });
  it('gives nothing for a missing or broken PUBLIC_URL (the config module reports it)', () => {
    expect(originEnv({})).toEqual({});
    expect(originEnv({ PUBLIC_URL: '' })).toEqual({});
    expect(originEnv({ PUBLIC_URL: 'nonsense' })).toEqual({});
  });
  it('agrees with the config module on what the address is', () => {
    for (const url of ['https://a.example.org', 'http://localhost:3000/', 'http://10.0.0.5:8080']) {
      const cfg = loadConfig({ PUBLIC_URL: url });
      expect(originEnv({ PUBLIC_URL: url })).toEqual({ ORIGIN: cfg.publicUrl });
    }
  });
  it('reads HTTPS_MODE like the config module (or the config module refuses)', () => {
    for (const mode of ['DIRECT', ' direct ', '', undefined, 'direct', 'proxy', 'Proxy']) {
      const env = { PUBLIC_URL: 'https://a.example.org', LOCAL_HOSTS: '10.0.0.5', HTTPS_MODE: mode };
      let cfgMode: string | undefined;
      try {
        cfgMode = loadConfig(env).httpsMode;
      } catch {
        cfgMode = undefined; // refused: the start stops, whatever originEnv says
      }
      if (cfgMode === undefined) continue;
      const direct = 'HOST_HEADER' in originEnv(env);
      expect(direct, `HTTPS_MODE=${JSON.stringify(mode)}`).toBe(cfgMode === 'direct');
    }
  });
  it('the CLI prints shell lines for eval', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/tls/origin.mjs')], {
      encoding: 'utf8',
      env: specEnv({ PUBLIC_URL: 'https://x.example.org', HTTPS_MODE: 'proxy' }),
    });
    expect(r.stdout.trim()).toBe("export ORIGIN='https://x.example.org'");
  });
});

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

describe('direct mode: the gate, not a hidden port, protects the forwarded headers', () => {
  const config = {
    httpsMode: 'direct' as const,
    trustedProxies: [],
    localHosts: ['192.168.1.90'],
    httpsPort: 8443,
  };
  it('a non-loopback peer with forged X-Forwarded-* is redirected, never served', () => {
    const headers = new Headers({
      'x-forwarded-host': 'evil.example.org',
      'x-forwarded-proto': 'https',
      origin: 'https://evil.example.org',
    });
    const gate = transportGate({ config, peer: '192.168.1.77', headers, path: '/api/auth/login' });
    expect(gate.https).toBe(false);
    expect(gate.redirect).toBe('https://192.168.1.90:8443/api/auth/login');
  });
});

const children: ChildProcess[] = [];
const dirs: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGTERM');
  for (const c of closers.splice(0)) c();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Starts `build/index.js` with only these variables (no ORIGIN). Proxy mode goes through the container's entrypoint;
 * direct mode would start the front on the container's fixed port there, so the spec applies `originEnv` itself and
 * runs the front on a free port.
 */
async function startApp(env: Record<string, string>): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'origin-spec-'));
  dirs.push(dir);
  const port = await freePort();
  const full = specEnv({
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dir,
    PACK_BUILD: '0',
    TIMERS_INTERVAL_S: '0',
    UEBERBLICK_INSECURE_COOKIES: '1',
    ...env,
  });
  const child =
    env.HTTPS_MODE === 'direct'
      ? spawn(process.execPath, [join(WEB, 'build/index.js')], {
          cwd: WEB,
          stdio: 'ignore',
          env: { ...full, ...originEnv(full) },
        })
      : spawn('sh', [ENTRYPOINT, process.execPath, join(WEB, 'build/index.js')], {
          cwd: ROOT, // the entrypoint finds scripts/tls/origin.mjs from the container's WORKDIR
          stdio: 'ignore',
          env: full,
        });
  children.push(child);
  for (let i = 0; i < 150; i += 1) {
    const ok = await new Promise<boolean>((resolve) => {
      const r = httpRequest({ host: '127.0.0.1', port, path: '/api/health' }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      r.on('error', () => resolve(false));
      r.end();
    });
    if (ok) return port;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('the app did not start');
}

const FORM = 'application/x-www-form-urlencoded';

describe.skipIf(!built)('the built app with PUBLIC_URL only', () => {
  const post = (port: number, origin: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const r = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/api/auth/login',
          method: 'POST',
          headers: { origin, 'content-type': FORM },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      r.on('error', reject);
      r.end('a=b');
    });

  it('proxy mode accepts a same-origin form POST and refuses a foreign one', async () => {
    const url = 'https://ueberblick.example.org';
    const port = await startApp({ PUBLIC_URL: url, HTTPS_MODE: 'proxy' });
    expect(await post(port, url)).not.toBe(403);
    expect(await post(port, 'https://evil.example.org')).toBe(403);
    expect(await post(port, `http://127.0.0.1:${port}`)).toBe(403); // the proxy's Host is not trusted
  }, 60_000);

  it('direct mode through the TLS front accepts POSTs from two LOCAL_HOSTS and refuses a foreign origin', async () => {
    const appPort = await startApp({
      PUBLIC_URL: 'https://127.0.0.1:8443',
      HTTPS_MODE: 'direct',
      LOCAL_HOSTS: '127.0.0.1,localhost',
    });
    const dir = mkdtempSync(join(tmpdir(), 'origin-front-'));
    dirs.push(dir);
    const hosts = ['127.0.0.1', 'localhost'];
    const m = loadTlsMaterial({ dir, hosts });
    const front = await startTlsFront(
      { key: m.server.keyPem, cert: m.server.certPem },
      { host: '127.0.0.1', port: 0, upstreamPort: appPort, allowedHosts: hosts },
    );
    closers.push(() => front.close());
    const port = (front.address() as AddressInfo).port;
    const ca = readFileSync(join(dir, 'ca.crt'), 'utf8');
    const send = (host: string, origin: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const r = httpsRequest(
          {
            host: '127.0.0.1',
            port,
            ca,
            checkServerIdentity: () => undefined, // the Host header varies; the CA still signs the chain
            path: '/api/auth/login',
            method: 'POST',
            headers: { host: `${host}:${port}`, origin, 'content-type': FORM },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        r.on('error', reject);
        r.end('a=b');
      });
    expect(await send('127.0.0.1', `https://127.0.0.1:${port}`)).not.toBe(403);
    expect(await send('localhost', `https://localhost:${port}`)).not.toBe(403);
    expect(await send('127.0.0.1', 'https://evil.example.org')).toBe(403);
    expect(await send('127.0.0.1', `https://localhost:${port}`)).toBe(403); // another address's origin is not this one
    expect(await send('evil.example.org', 'https://evil.example.org')).toBe(421); // the front serves LOCAL_HOSTS only
  }, 60_000);

  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i?.family === 'IPv4' && !i.internal)?.address;
  it.skipIf(lan === undefined)(
    'direct mode: forged X-Forwarded-Host plus a matching Origin from a non-loopback peer gets 308 on the app port',
    async () => {
      const appPort = await startApp({
        PUBLIC_URL: 'https://192.168.1.90:8443',
        HTTPS_MODE: 'direct',
        LOCAL_HOSTS: '192.168.1.90',
        HOST: '0.0.0.0',
      });
      const status = await new Promise<number>((resolve, reject) => {
        const r = httpRequest(
          {
            host: lan,
            port: appPort,
            path: '/api/auth/login',
            method: 'POST',
            headers: {
              'x-forwarded-host': 'evil.example.org',
              'x-forwarded-proto': 'https',
              origin: 'https://evil.example.org',
              'content-type': FORM,
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        r.on('error', reject);
        r.end('a=b');
      });
      expect(status).toBe(308);
    },
    60_000,
  );
});
