import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';

// WP-132: vitest creates /tmp/<21 random chars>/{client,ssr} (25 MB) per run and never removes it.
// scripts/ops/vitest-scoped.mjs scopes TMPDIR to a directory it deletes, so a run must leave nothing behind.
const root = fileURLToPath(new URL('../..', import.meta.url));
// Each run gets a private TMPDIR parent, so other agents' /tmp entries cannot disturb the count.
const privateTmp = <T>(fn: (parent: string) => T): T => {
  const parent = mkdtempSync(join(tmpdir(), 'tmpleak-parent-'));
  try {
    return fn(parent);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
};

it('a test-record run leaves no scratch directory in its TMPDIR', () => {
  privateTmp((parent) => {
    const r = spawnSync('node', ['scripts/metrics/test-record.mjs', 'scripts/ops/tmpleak.fixture.spec.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: specEnv({ UB_NO_RECORD: '1', TMPDIR: parent }),
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readdirSync(parent)).toEqual([]);
  });
}, 120_000);

it('the vitest-scoped wrapper leaves nothing behind, also when the tests fail', () => {
  privateTmp((parent) => {
    const r = spawnSync(
      'node',
      ['scripts/ops/vitest-scoped.mjs', 'run', 'scripts/ops/no-such-file.spec.ts'],
      {
        cwd: root,
        encoding: 'utf8',
        env: specEnv({ TMPDIR: parent }),
      },
    );
    expect(r.status).not.toBe(0);
    expect(readdirSync(parent)).toEqual([]);
  });
}, 120_000);

it('every vitest start in the root scripts goes through the wrapper (so npm run check leaks nothing)', () => {
  const scripts = (
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  ).scripts;
  const raw = Object.entries(scripts).filter(
    ([, cmd]) => /\bvitest\b/.test(cmd) && !cmd.includes('vitest-scoped.mjs'),
  );
  expect(raw.map(([name]) => name)).toEqual([]);
  expect(scripts['test:record']).toContain('test-record.mjs');
  for (const f of ['scripts/metrics/test-record.mjs', 'bench/harness/cli.mjs']) {
    expect(readFileSync(join(root, f), 'utf8'), f).toContain('scopedTmp(');
  }
});

it.each(['SIGINT', 'SIGTERM'] as const)(
  'scopedTmp removes its directory when the process gets %s',
  async (signal) => {
    const script = `
    import { scopedTmp } from './scripts/ops/vitest-scoped.mjs';
    const t = scopedTmp('sigtest-');
    console.log(t.dir);
    setInterval(() => {}, 1000);
  `;
    const child = spawn('node', ['--input-type=module', '-e', script], { cwd: root, env: specEnv() });
    const dir = await new Promise<string>((resolve) => {
      child.stdout.once('data', (d: Buffer) => resolve(String(d).trim()));
    });
    expect(existsSync(dir)).toBe(true);
    const code = new Promise<number | null>((resolve) => child.on('close', resolve));
    child.kill(signal);
    expect(await code).toBe(signal === 'SIGINT' ? 130 : 143);
    expect(existsSync(dir)).toBe(false);
  },
  30_000,
);

const withoutMarker = (extra: Record<string, string>): NodeJS.ProcessEnv => specEnv(extra);
// Node itself may put node-compile-cache in TMPDIR; only vitest's 21-char scratch names count.
const vitestDirs = (parent: string): string[] => readdirSync(parent).filter((n) => /^[\w-]{21}$/.test(n));
const REFUSAL = 'run tests with npm test -- <path> (vitest direct runs leak /tmp, WP-132)';

// WP-141: a direct `npx vitest` bypasses the wrapper and leaks. Every config refuses to start without the marker.
it('a direct npx vitest run is refused before vitest creates its scratch directory', () => {
  privateTmp((parent) => {
    const r = spawnSync('npx', ['vitest', 'run', 'scripts/ops/tmpleak.fixture.spec.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: withoutMarker({ TMPDIR: parent }),
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain(REFUSAL);
    expect(vitestDirs(parent)).toEqual([]);
  });
}, 120_000);

it.each(['bench/vitest.config.ts', 'bench/geo/vitest.config.ts', 'bench/harness/vitest.config.ts'])(
  'a direct run with -c %s is refused too',
  (config) => {
    privateTmp((parent) => {
      const r = spawnSync('npx', ['vitest', 'run', '-c', config], {
        cwd: root,
        encoding: 'utf8',
        env: withoutMarker({ TMPDIR: parent }),
      });
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toContain(REFUSAL);
      expect(vitestDirs(parent)).toEqual([]);
    });
  },
  120_000,
);

it('npm test -- <spec> passes and its scratch directory is gone afterwards', () => {
  privateTmp((parent) => {
    const r = spawnSync('npm', ['test', '--', 'scripts/ops/tmpleak.fixture.spec.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: withoutMarker({ TMPDIR: parent }),
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(vitestDirs(parent)).toEqual([]);
  });
}, 120_000);

it('setting the marker by hand is the explicit escape hatch', () => {
  privateTmp((parent) => {
    const r = spawnSync('npx', ['vitest', 'run', 'scripts/ops/tmpleak.fixture.spec.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: specEnv({ UEB_VITEST_SCOPED: '1', TMPDIR: parent }),
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    rmSync(parent, { recursive: true, force: true }); // this path leaks by design
  });
}, 120_000);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'reference' || e.name.startsWith('.git')) continue;
    if (e.name === '.claude') continue;
    const rel = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
};

it('every vitest config imports the shared guard', () => {
  const configs = walk('.').filter(
    (f) => /(^|\/)vitest\.config\.[cm]?[jt]s$/.test(f) && !f.startsWith('.claude/'),
  );
  expect(configs.length).toBeGreaterThanOrEqual(5);
  for (const f of configs)
    expect(readFileSync(join(root, f), 'utf8'), f).toContain('vitest-scoped.guard.mjs');
});

it('no doc, agent definition or package script shows a bare vitest start', () => {
  const historical = (f: string) => f.startsWith('docs/research/') || f.startsWith('docs/history/');
  // The public export (scripts/publish) has no agent docs; in the dev repo they must be checked.
  const agentDocs = existsSync(join(root, 'CLAUDE.md')) ? ['CLAUDE.md', ...walk('.claude/agents')] : [];
  const files = [
    ...agentDocs,
    ...walk('.').filter((f) => f.endsWith('/README.md') || f === 'README.md'),
    ...walk('docs'),
    ...walk('bench').filter((f) => f.endsWith('.ts')),
  ]
    .filter((f) => f.endsWith('.md') || f.startsWith('bench/'))
    .filter((f) => !historical(f));
  expect(files).toEqual(expect.arrayContaining(agentDocs));
  const bare = /\b(npx\s+vitest|vitest\s+run)\b/;
  expect(files.filter((f) => bare.test(readFileSync(join(root, f), 'utf8')))).toEqual([]);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(Object.values(pkg.scripts).filter((c) => bare.test(c) && !c.includes('vitest-scoped.mjs'))).toEqual(
    [],
  );
});
