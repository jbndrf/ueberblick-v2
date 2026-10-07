import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GATED_VAR,
  RUN_ALONE,
  SUITES,
  gateCommand,
  planShards,
  missingSuites,
  parseArgs,
  runSuites,
  selectSuites,
  // @ts-expect-error plain .mjs runner without declarations
} from './run.mjs';
// @ts-expect-error plain .mjs without declarations
import { repeatCapError } from './repeat-cap.mjs';
// @ts-expect-error plain .mjs without declarations
import { fileFilter } from './affected-plan.mjs';
import { specEnv } from '../testing/spec-env.mjs';
import { prepareBuild } from '../ops/web-build.mjs';

interface Suite {
  readonly id: string;
  readonly name: string;
  readonly config: string;
}
interface Result {
  ok: boolean;
  failed: string[];
  missing: string[];
}
const suites = SUITES as readonly Suite[];
const run = runSuites as (
  s: readonly Suite[],
  root: string,
  run: (s: Suite) => number | Promise<number>,
  exists: (p: string) => boolean,
) => Promise<Result>;
const missing = missingSuites as (
  s: readonly Suite[],
  root: string,
  exists: (p: string) => boolean,
) => Suite[];

describe('npm run e2e suites', () => {
  it('lists web, a11y, participant and the v3 journeys', () => {
    expect(suites.map((s) => s.name)).toEqual(['apps/web', 'e2e/a11y', 'e2e/participant', 'e2e/journeys']);
  });
  it('fails when a configured suite has no config file', async () => {
    const ran: string[] = [];
    const r = await run(
      suites,
      '/r',
      (s) => {
        ran.push(s.name);
        return 0;
      },
      (p) => !p.includes('participant'),
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['e2e/participant']);
    expect(ran).toEqual(['apps/web', 'e2e/a11y', 'e2e/journeys']);
  });
  it('fails when a suite fails (a new a11y violation) and still runs the rest', async () => {
    const ran: string[] = [];
    const r = await run(
      suites,
      '/r',
      (s) => {
        ran.push(s.name);
        return s.name === 'e2e/a11y' ? 1 : 0;
      },
      () => true,
    );
    expect(r).toEqual({ ok: false, failed: ['e2e/a11y'], missing: [] });
    expect(ran).toHaveLength(4);
  });
  it('passes when all suites pass', async () => {
    const r = await run(
      suites,
      '/r',
      () => 0,
      () => true,
    );
    expect(r.ok).toBe(true);
    expect(missing(suites, '/r', () => true)).toEqual([]);
  });
});

describe('a run with a file filter', () => {
  const ok = { ok: true, failed: [], missing: [] };
  const judge = (args: string[], specs: number) => fileFilter.judge(ok, '/x', [], args, () => specs);
  it('adds --pass-with-no-tests only when a path filter is given', () => {
    expect(fileFilter.args('/x', [], ['apps/web/e2e/a.spec.ts'])).toEqual(['--pass-with-no-tests']);
    expect(fileFilter.args('/x', [], ['--repeat-each', '3'])).toEqual([]);
  });
  it('keeps the verdict when some suite ran a test (the others pass with no tests)', () => {
    expect(judge(['apps/web/e2e/a.spec.ts'], 3)).toBe(ok);
  });
  it('fails when no suite ran a test, so a mistyped path does not pass', () => {
    expect(judge(['apps/web/e2e/nope.spec.ts'], 0)).toEqual({
      ok: false,
      failed: ['no test matched the file filter'],
      missing: [],
    });
  });
  it('leaves a run without a file filter alone', () => {
    expect(judge([], 0)).toBe(ok);
  });
});

describe('--suite selection', () => {
  const pick = (argv: string[]) => {
    const { names } = (parseArgs as (a: string[]) => { names: string[]; rest: string[] })(argv);
    return (selectSuites as (s: readonly Suite[], n: string[]) => Suite[])(suites, names).map((s) => s.id);
  };
  it('selects only the journeys suite', () => {
    expect(pick(['--suite', 'journeys'])).toEqual(['journeys']);
  });
  it('selects two suites with two flags, in run order', () => {
    expect(pick(['--suite', 'journeys', '--suite=a11y'])).toEqual(['a11y', 'journeys']);
  });
  it('selects all suites without the flag', () => {
    expect(pick([])).toEqual(['apps-web', 'a11y', 'participant', 'journeys']);
  });
  it('rejects an unknown suite name clearly', () => {
    expect(() => pick(['--suite', 'nope'])).toThrow(/unknown suite nope \(known: apps-web, a11y/);
  });
  it('passes other arguments through to Playwright', () => {
    const r = (parseArgs as (a: string[]) => { names: string[]; rest: string[] })([
      '--suite',
      'a11y',
      '--project',
      'chromium',
      '-g',
      'x',
    ]);
    expect(r.rest).toEqual(['--project', 'chromium', '-g', 'x']);
  });
});

describe('root package.json scripts', () => {
  it('has the e2e and backup shorthands', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['e2e:journeys']).toBe('node scripts/e2e/run.mjs --suite journeys');
    expect(pkg.scripts['backup:restore-folder']).toContain('scripts/backup/restore.mjs');
    expect(pkg.scripts['backup:restore-folder']).toContain('register.mjs');
    expect(pkg.scripts['backup:roundtrip']).toContain('scripts/backup/docker-roundtrip.mjs');
  });
});

describe('shard plan from a test listing (WP-1016)', () => {
  const plan = planShards as (
    s: { name: string },
    env: Record<string, string>,
    history: Record<string, number>,
    k: number,
    list: () => Promise<unknown>,
  ) => Promise<string[][] | undefined>;
  const listing = {
    suites: ['big', 'a', 'b', 'c'].map((n) => ({
      file: `${n}.e2e.ts`,
      specs: Array.from({ length: n === 'big' ? 1 : 4 }, () => ({
        file: `${n}.e2e.ts`,
        tests: [{ results: [] }],
      })),
    })),
  };
  it('balances by history, by count without it', async () => {
    const hist = { 'big.e2e.ts': 900, 'a.e2e.ts': 100, 'b.e2e.ts': 100, 'c.e2e.ts': 100 };
    const ok = async () => listing;
    expect(await plan({ name: 's' }, {}, hist, 2, ok)).toEqual([
      ['big.e2e.ts'],
      ['a.e2e.ts', 'b.e2e.ts', 'c.e2e.ts'],
    ]);
    expect((await plan({ name: 's' }, {}, {}, 2, ok))?.flat().sort()).toEqual([
      'a.e2e.ts',
      'b.e2e.ts',
      'big.e2e.ts',
      'c.e2e.ts',
    ]);
    expect(await plan({ name: 's' }, {}, {}, 2, ok)).toEqual([
      ['a.e2e.ts', 'c.e2e.ts'],
      ['b.e2e.ts', 'big.e2e.ts'],
    ]);
  });
  it('gives undefined (the --shard split) when the suite cannot be listed', async () => {
    const err = console.error;
    console.error = () => {};
    try {
      expect(
        await plan({ name: 's' }, {}, {}, 2, async () => Promise.reject(new Error('boom'))),
      ).toBeUndefined();
    } finally {
      console.error = err;
    }
  });
  it('lists no suite that runs alone without a reason', () => {
    for (const reason of Object.values(RUN_ALONE as Record<string, string>))
      expect(reason.length).toBeGreaterThan(10);
  });
});

describe('e2e gate wiring (WP-1016)', () => {
  const gc = gateCommand as (
    a: string[],
    env: Record<string, string>,
  ) => { args: string[]; env: Record<string, string> } | null;
  it('re-runs itself under the e2e pool of check-gate.sh, once', () => {
    const g = gc(['--suite', 'a11y'], {});
    expect(g?.args[0]).toMatch(/scripts\/ops\/check-gate\.sh$/);
    expect(g?.args[1]).toBe('--e2e');
    expect(g?.args.slice(-2)).toEqual(['--suite', 'a11y']);
    expect(g?.env[GATED_VAR as string]).toBe('1');
    expect(gc([], { [GATED_VAR as string]: '1' })).toBeNull();
  });
});

describe('servers die with the run (WP-1030)', () => {
  const src = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  it('installs the reaper before it starts anything, and never blocks on spawnSync around Playwright', () => {
    expect(src).toMatch(/import \{ installReaper \} from '\.\/server-reap\.mjs'/);
    expect(src.indexOf('installReaper();')).toBeLessThan(src.indexOf('gateCommand(process.argv'));
    expect(src).not.toMatch(/spawnSync\(gated/);
    expect(src).not.toMatch(/function sh\([^)]*\) \{\s*return spawnSync/);
    expect(src).toMatch(/function sh\([^)]*\) \{\s*return new Promise/);
  });
});

describe('rss spec scratch dir (WP-1016)', () => {
  const src = readFileSync(new URL('../../apps/web/e2e/rss.spec.ts', import.meta.url), 'utf8');
  it('is made per run with mkdtemp and removed afterwards, never a fixed path', () => {
    expect(src).toMatch(/mkdtempSync\(join\(tmpdir\(\), 'ueberblick-e2e-rss-'\)\)/);
    expect(src).not.toMatch(/join\(tmpdir\(\), 'ueberblick-e2e-rss'\)/);
    expect(src).toMatch(/finally \{[^}]*rmSync\(dir/s);
  });
});

describe('e2e web build reuse (WP-1029)', () => {
  const prepare = prepareBuild;
  const call = async (isStale: boolean) => {
    const lines: string[] = [];
    const asked: string[] = [];
    let builds = 0;
    const built = await prepare({
      root: '/x',
      stale: (_r, o) => (asked.push(o.flavour), isStale),
      ensure: async (o) => (asked.push(o.flavour), (builds += 1), true),
      log: (m) => lines.push(m),
    });
    return { built, builds, lines, asked };
  };
  it('reuses a current probe build and says so', async () => {
    const r = await call(false);
    expect(r.builds).toBe(0);
    expect(r.built).toBe(false);
    expect(r.lines).toEqual(['e2e: web build is current (probe), reused']);
  });
  it('builds the probe flavour only when stale', async () => {
    const r = await call(true);
    expect(r.builds).toBe(1);
    expect(r.asked).toEqual(['probe', 'probe']);
    expect(r.lines).toEqual(['e2e: building the web app (probe) …']);
  });
});

describe('--repeat-each cap (WP-1035)', () => {
  const cap = repeatCapError as (a: string[], env: Record<string, string>) => string | null;
  const line =
    'e2e: --repeat-each N is over 10; a repeat run holds a shared e2e slot. Ask your lead, then rerun with UEB_E2E_REPEAT_OK=1';
  it('refuses 11 in both spellings with the one line, allows 10 and plain runs', () => {
    expect(cap(['--repeat-each', '11'], {})).toBe(line);
    expect(cap(['--repeat-each=80'], {})).toBe(line);
    expect(cap(['--repeat-each', '10'], {})).toBeNull();
    expect(cap(['--repeat-each=3'], {})).toBeNull();
    expect(cap(['--suite', 'a11y'], {})).toBeNull();
  });
  it('UEB_E2E_REPEAT_OK=1 passes 80 through', () => {
    expect(cap(['--repeat-each', '80'], { UEB_E2E_REPEAT_OK: '1' })).toBeNull();
  });
  it('npm run e2e exits 64 with the line before it starts anything', () => {
    const run = fileURLToPath(new URL('./run.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [run, '--repeat-each', '11'], {
      encoding: 'utf8',
      env: specEnv(),
    });
    expect(r.status).toBe(64);
    expect(r.stderr.trim()).toBe(line);
  });
});
