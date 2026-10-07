// WP-491: static proof of the step-1 deploy elements. No docker build, no `compose up`: Dockerfile, entrypoint,
// compose files (`docker compose config` for both modes) and the server-install doc are read as text.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DECLARED, DOCUMENTED } from '../../apps/web/src/lib/server/config/vars';
import { specEnv } from '../testing/spec-env.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const dockerfile = read('Dockerfile');
const entrypoint = read('scripts/docker/entrypoint.sh');
const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));

describe('s1.container-image: multi-stage, non-root, HEALTHCHECK, one /data volume', () => {
  it('is multi-stage: a build stage with compilers, a slim runtime that copies only the build output', () => {
    expect([...dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gm)].map((m) => m[2])).toEqual([
      'build',
      'runtime',
    ]);
    expect(runtime).toMatch(/^FROM node:\S*-slim AS runtime/m);
    expect(runtime).toMatch(/COPY --from=build \/app\/apps\/web\/build/);
    expect(runtime).not.toMatch(/npm (ci|install)/);
  });

  it('drops root: the entrypoint chowns /data, then execs as the user node', () => {
    expect(entrypoint).toMatch(/chown node:node/);
    expect(entrypoint).toMatch(/exec setpriv --reuid=node --regid=node/);
    expect(dockerfile).not.toMatch(/^USER\s+root/m);
    expect(runtime).toMatch(/ENTRYPOINT \["\/usr\/local\/bin\/entrypoint\.sh"\]/);
  });

  it('has a HEALTHCHECK on /api/health with a start period', () => {
    expect(runtime).toMatch(/HEALTHCHECK --interval=\d+s --timeout=\d+s --start-period=\d+s/);
    expect(runtime).toContain('/api/health');
  });

  it('keeps all state in one volume, /data, which is also where the app is told to write', () => {
    expect([...dockerfile.matchAll(/^VOLUME\s+(.+)$/gm)].map((m) => m[1])).toEqual(['/data']);
    expect(runtime).toMatch(/DATA_DIR=\/data/);
    expect(read('docker-compose.yaml')).toMatch(/- \.\/data:\/data/);
  });
});

type ComposeApp = { environment: Record<string, string>; ports: { target: number; published: string }[] };

describe('s1.compose-two-modes: one docker-compose.yaml, HTTPS_MODE proxy or direct', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compose-spec-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  for (const f of ['docker-compose.yaml', 'docker-compose.direct.yaml'])
    copyFileSync(join(root, f), join(dir, f));

  const config = (env: string, files: string[]): ComposeApp => {
    writeFileSync(join(dir, '.env'), env);
    const args = files.flatMap((f) => ['-f', f]);
    const r = spawnSync('docker', ['compose', ...args, 'config', '--format', 'json'], {
      cwd: dir,
      encoding: 'utf8',
      env: specEnv(),
    });
    if (r.error !== undefined || r.status !== 0) throw new Error(`docker compose config failed: ${r.stderr}`);
    return (JSON.parse(r.stdout) as { services: { app: ComposeApp } }).services.app;
  };
  const base = read('.env.example').replace('LOCAL_HOSTS=', 'LOCAL_HOSTS=192.168.1.20');
  const hasDocker = spawnSync('docker', ['compose', 'version'], { env: specEnv() }).status === 0;

  it.skipIf(!hasDocker)(
    'proxy mode: the main file alone is valid, no http redirect port is published',
    () => {
      const app = config(base, ['docker-compose.yaml']);
      expect(app.environment['DATA_DIR']).toBe('/data');
      expect(app.ports.map((p) => p.target).sort()).toEqual([3000, 8443]);
      expect(app.ports.find((p) => p.target === 3000)?.published).toBe('3000');
    },
  );

  it.skipIf(!hasDocker)(
    'direct mode: the override also publishes HTTP_PORT; the https port is HTTPS_PORT',
    () => {
      const env = base
        .replace('HTTPS_MODE=proxy', 'HTTPS_MODE=direct')
        .replace('HTTPS_PORT=8443', 'HTTPS_PORT=9443')
        .replace('HTTP_PORT=8080', 'HTTP_PORT=9080');
      const ports = config(env, ['docker-compose.yaml', 'docker-compose.direct.yaml']).ports;
      expect(ports.find((p) => p.target === 8443)?.published).toBe('9443');
      expect(ports.find((p) => p.target === 8080)?.published).toBe('9080');
    },
  );

  it('HTTPS_MODE is a switch of the app, not a second compose file: the entrypoint starts the TLS front for direct', () => {
    expect(entrypoint).toMatch(/\[ "\$\{HTTPS_MODE:-proxy\}" = "direct" \]/);
    expect(entrypoint).toMatch(/set -- node scripts\/tls\/front\.mjs "\$@"/);
    expect(read('docker-compose.yaml')).toContain('env_file: .env');
  });
});

describe('s1.docs-server-install: every command and name in the doc exists', () => {
  const docs = ['docs/user/admin/server-install.md', 'docs/user/admin/server-install.en.md'].map(
    (p) => [p, read(p)] as const,
  );
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  const cliRun = read('packages/server/src/admin/cli-run.ts');
  /** Names the doc may mention that are not in `.env.example`: compose, image and CLI inputs, each checked below. */
  const OTHER_NAMES = [
    'COMPOSE_FILE',
    'DATA_DIR',
    'BODY_SIZE_LIMIT',
    'UEBERBLICK_ADMIN_PASSWORD',
    'UEBERBLICK_LOG_LEVEL',
  ];
  const code = [
    read('docker-compose.yaml'),
    entrypoint,
    cliRun,
    read('apps/web/src/lib/server/config/vars.ts'),
  ].join('\n');

  for (const [path, text] of docs) {
    it(`${path}: each env name is in .env.example or a known input of the code`, () => {
      const names = [...new Set(text.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [])];
      const unknown = names.filter(
        (n) => !(DOCUMENTED as readonly string[]).includes(n) && !OTHER_NAMES.includes(n) && n !== 'ADMIN_',
      );
      expect(unknown).toEqual([]);
      const compose = read('docker-compose.direct.yaml') + read('.env.example');
      for (const n of OTHER_NAMES.filter((o) => text.includes(o))) {
        expect(n === 'COMPOSE_FILE' ? compose : code, n).toContain(n);
      }
    });

    it(`${path}: the compose files and repo paths it names exist`, () => {
      for (const f of ['docker-compose.yaml', 'docker-compose.direct.yaml', '.env.example']) {
        expect(text).toContain(f);
        expect(existsSync(join(root, f)), f).toBe(true);
      }
      expect(existsSync(join(root, 'apps/web/src/routes/setup/zertifikat'))).toBe(true);
      expect(text).toContain('/setup/zertifikat');
      expect(existsSync(join(root, 'fixtures/golden/templates/baumkataster/1.0.0.yaml'))).toBe(true);
      expect(text).toContain('fixtures/golden/templates/baumkataster/1.0.0.yaml');
    });

    it(`${path}: every \`npm run admin\` command is a command of the admin CLI`, () => {
      expect(pkg.scripts['admin']).toBeDefined();
      const commands = [...text.matchAll(/npm run admin -- ([a-z-]+)/g)].map((m) => m[1] as string);
      expect(commands.length).toBeGreaterThan(3);
      for (const c of commands) expect(cliRun, c).toContain(`'${c}'`);
    });

    it(`${path}: the docker compose commands it shows work with the compose file`, () => {
      expect(text).toContain('docker compose up -d');
      expect(text).toContain('docker compose up -d --build');
      expect(text).toContain('docker compose ps');
      expect(text).toContain('docker compose logs app');
      expect(read('docker-compose.yaml')).toMatch(/^\s{2}app:/m);
      expect(read('docker-compose.yaml')).toMatch(/build: \./);
    });

    it(`${path}: states the minimum admin password the code enforces, as .env.example does`, () => {
      const min = /MIN_ADMIN_PASSWORD = (\d+)/.exec(read('apps/web/src/lib/server/config/parse.ts'))?.[1];
      expect(min).toBeDefined();
      expect(text).toContain(`${min}`);
      expect(read('.env.example')).toContain(`${min} characters`);
    });
  }

  it('every .env.example variable is declared in the config module (the startup check refuses the rest)', () => {
    for (const n of DOCUMENTED) expect(DECLARED).toContain(n);
  });
});
