import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { findWallclockAsserts } from './guardrails/wallclock';
import { checkText } from './glossary-lint.mjs';
import { isPlanted, plant } from './testing/plant.mjs';
import { specEnv } from './testing/spec-env.mjs';

describe('glossary lint (R7)', () => {
  it('flags banned v3 terms with a replacement hint', () => {
    const problems = checkText('const workflowInstance = load(instance_id);', 'x.ts');
    expect(problems.length).toBe(2);
    expect(problems[0]).toMatch(/use feature/);
  });
  it('accepts glossary words', () => {
    expect(checkText('const feature = fold(state, observation);', 'x.ts')).toEqual([]);
  });
  it('honours an explicit ignore marker', () => {
    expect(checkText('// v3 called this workflow_instance  glossary-lint-ignore', 'x.ts')).toEqual([]);
  });
});

// WP-124: apps/* is part of the gate. Each test plants a violation in apps/web and runs the real command.
describe('check covers apps/* (WP-124)', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const planted = 'apps/web/src/lib/lib.planted.ts';
  let handle: { remove: () => void } | undefined;
  const scripts = (
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  ).scripts;
  const run = (cmd: string): { ok: boolean; out: string } => {
    const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', env: specEnv() });
    return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
  };
  const plantSrc = (src: string): void => {
    handle = plant(root, { [planted]: src });
  };
  afterEach(() => handle?.remove());

  it('wires the app type-check, lint and format into check, and e2e stays out', () => {
    expect(scripts['typecheck']).toContain('typecheck:web');
    // WP-930: lint runs its steps (lint:eslint, lint:prettier) through scripts/ops/steps.mjs.
    expect(scripts['lint']).toContain('lint:prettier');
    expect(scripts['lint:prettier']).toContain('apps/**');
    expect(scripts['e2e']).toContain('scripts/e2e/run.mjs');
    expect(scripts['check']).not.toContain('e2e');
  });

  // WP-143: the full `typecheck:web` runs in `npm run check`. Here the same compiler and the app's own tsconfig
  // check only the planted file (bounded work), so the case does not depend on how loaded the machine is.
  it('fails the type-check on a type error in apps/web', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'guardrail-tsc-'));
    try {
      const sync = run('npm exec -w @ueberblick/web -- svelte-kit sync');
      expect(sync.ok, sync.out).toBe(true);
      const cfg = join(tmp, 'tsconfig.json');
      writeFileSync(
        cfg,
        JSON.stringify({
          extends: join(root, 'apps/web/tsconfig.json'),
          compilerOptions: { typeRoots: [join(root, 'node_modules/@types')] },
          include: [join(root, 'apps/web/.svelte-kit/ambient.d.ts'), join(root, planted)],
          exclude: [], // apps/web/tsconfig.json excludes plants (WP-1022); this one wants it
        }),
      );
      plantSrc("export const n: number = 'not a number';\n");
      const r = run(`npx tsc -p ${cfg} --noEmit`);
      expect(r.ok).toBe(false);
      expect(r.out).toContain('lib.planted.ts');
      handle?.remove();
      plantSrc('export const n: number = 1;\n');
      const ok = run(`npx tsc -p ${cfg} --noEmit`);
      expect(ok.ok, ok.out).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails lint on a lint violation in apps/web', () => {
    plantSrc('export const x: any = 1;\n');
    // WP-1022: eslint skips plants by default (a whole-repo run beside plant-writing specs must not hit ENOENT);
    // a spec that lints a plant on purpose passes --no-ignore.
    const r = run('npx eslint --no-ignore apps/web/src/lib/lib.planted.ts');
    expect(r.ok).toBe(false);
    expect(r.out).toContain('no-explicit-any');
  }, 60_000);

  it.each(
    ['tsconfig.json', 'packages/ui', 'packages/builder', 'apps/web', 'bench'].map((d) =>
      d.endsWith('.json') ? d : `${d}/tsconfig.json`,
    ),
  )('%s excludes plants, so a whole-repo typecheck cannot race plant-writing specs (WP-1022)', (file) => {
    const cfg = readFileSync(join(root, file), 'utf8');
    expect(cfg).toContain('"**/*.planted*"');
    expect(cfg).toContain('"**/*.planted/**"');
  });

  it('boundaries skips plants (the config exclude, plus .planted), so it cannot race plant-writing specs', () => {
    expect(scripts['boundaries']).toContain('\\.planted');
    const cfg = readFileSync(join(root, '.dependency-cruiser.cjs'), 'utf8');
    const m = /exclude: \{ path: '(\(node_modules[^']*\))' \}/.exec(cfg);
    // The CLI --exclude replaces the config's: it must keep every alternative the config has.
    for (const alt of (m?.[1] ?? '').slice(1, -1).replaceAll('\\\\', '\\').split('|'))
      expect(scripts['boundaries']).toContain(alt);
  });

  it('eslint ignores plants by default', () => {
    plantSrc('export const x: any = 1;\n');
    const r = run('npx eslint --max-warnings 0 apps/web/src/lib/lib.planted.ts');
    expect(r.out).toMatch(/ignore/i);
    expect(r.out).not.toContain('no-explicit-any');
    const cfg = readFileSync(join(root, 'eslint.config.js'), 'utf8');
    expect(cfg).toContain("'**/*.planted*'");
    expect(cfg).toContain("'**/*.planted/'");
  }, 60_000);

  it('fails the format check on a format violation in apps/web', () => {
    plantSrc("export const x   =   'a'\n");
    // WP-939: a prettier run without --cache-location deletes the default cache file; this one keeps its own.
    // --ignore-path /dev/null: .prettierignore skips plants (they race with whole-repo checks), this one must see it.
    const cacheDir = mkdtempSync(join(tmpdir(), 'guardrail-prettier-'));
    const r = run(
      `npx prettier --check --ignore-path /dev/null --cache-location ${join(cacheDir, 'cache.json')} apps/web/src/lib/lib.planted.ts`,
    );
    rmSync(cacheDir, { recursive: true, force: true });
    expect(r.ok).toBe(false);
    expect(scripts['lint:prettier']).toContain('prettier --check');
  }, 60_000);
});

// WP-147: unit specs assert behaviour, never wall-clock time (budgets live in bench/ via defineBudget).
describe('no wall-clock assertions in unit specs (WP-147)', () => {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wallclock-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const scanPlant = (name: string, src: string): string[] => {
    const p = plant(tmp, { [`packages/x/src/${name}.planted.spec.ts`]: src });
    try {
      return findWallclockAsserts(tmp, { includePlants: true }).map((v) => v.file);
    } finally {
      p.remove();
    }
  };
  const bad = `const t = performance.now();\nexpect(performance.now() - t).toBeLessThan(1);\n`;

  // The three real patterns of 2026-09-30.
  it('fails the WP-207 views pattern: inline clock difference inside expect', () => {
    const src = `it('x', () => {\n  const t0 = performance.now();\n  doIt();\n  expect(performance.now() - t0).toBeLessThan(200);\n});\n`;
    expect(scanPlant('views', src)).toHaveLength(1);
  });
  it('fails the WP-205 task pattern: elapsed variable, and best-of loop', () => {
    const a = `it('x', async () => {\n  const start = performance.now();\n  await go();\n  const ms = performance.now() - start;\n  expect(ms).toBeLessThan(200);\n});\n`;
    const b = `it('x', () => {\n  let best = Infinity;\n  for (let i = 0; i < 5; i++) {\n    const t = performance.now();\n    run();\n    best = Math.min(best, performance.now() - t);\n  }\n  expect(best).toBeLessThan(200);\n});\n`;
    expect(scanPlant('task-a', a)).toHaveLength(1);
    expect(scanPlant('task-b', b)).toHaveLength(1);
  });
  it('fails the WP-208 RunLog pattern: times pushed, then Math.min(...times)', () => {
    const src = `it('x', () => {\n  const times: number[] = [];\n  for (let i = 0; i < 5; i += 1) {\n    const t = performance.now();\n    render();\n    times.push(performance.now() - t);\n  }\n  expect(Math.min(...times)).toBeLessThanOrEqual(300);\n});\n`;
    expect(scanPlant('runlog', src)).toHaveLength(1);
  });
  it('fails on Date.now and hrtime too', () => {
    const d = `const a = Date.now();\nrun();\nexpect(Date.now() - a).toBeGreaterThan(-1);\n`;
    const h = `const a = process.hrtime.bigint();\nrun();\nconst d = process.hrtime.bigint() - a;\nexpect(Number(d)).toBeLessThan(1e9);\n`;
    expect(scanPlant('date', d)).toHaveLength(1);
    expect(scanPlant('hr', h)).toHaveLength(1);
  });
  it('passes a spec that only logs a duration, and clocks used for other things', () => {
    const log = `it('x', () => {\n  const t = performance.now();\n  run();\n  console.info(performance.now() - t);\n  expect(run()).toBe(1);\n});\n`;
    const id = `const id = Date.now();\nconst rows = make(id);\nexpect(rows.length).toBeGreaterThan(1);\n`;
    const comment = `// never expect(performance.now() - t).toBeLessThan(200)\nexpect(1).toBeLessThan(2);\n`;
    expect(scanPlant('log', log)).toEqual([]);
    expect(scanPlant('id', id)).toEqual([]);
    expect(scanPlant('comment', comment)).toEqual([]);
  });
  it('skips bench/ and non-spec files', () => {
    const p = plant(tmp, { 'bench/x/b.planted.spec.ts': bad, 'packages/x/src/helper.planted.ts': bad });
    try {
      expect(findWallclockAsserts(tmp, { includePlants: true })).toEqual([]);
    } finally {
      p.remove();
    }
  });
  it('ignores plants by default, like glossary-lint', () => {
    const p = plant(tmp, { 'packages/x/src/a.planted.spec.ts': bad });
    try {
      expect(findWallclockAsserts(tmp)).toEqual([]);
    } finally {
      p.remove();
    }
  });

  it('main has no wall-clock assertion in any unit spec', () => {
    const found = findWallclockAsserts(repo).map((v) => `${v.file}:${v.line}`);
    expect(found).toEqual([]);
  });
});

// WP-913: a bench judges a timing budget only through assertBudget(report(...)), which is load-aware
// (bench/harness). A raw `expect(ms).toBeLessThan(limit)` fails a busy machine with a false red.
// Every toBeLessThan* in a bench is flagged, unless its subject names a non-timing quantity.
const NON_TIMING_SUBJECT = /heap|growth|hits|count|length|rss|\bmb\b/i;
const LESS = /^\s*\.(?:not\.)?toBeLessThan(?:OrEqual)?\s*\(/;

/** Line numbers of every `expect(<subject>).toBeLessThan*(` whose subject is not a non-timing allowlist name. */
function rawLessLines(source: string): number[] {
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  const lines: number[] = [];
  const expects = /\bexpect\s*\(/g;
  for (let m = expects.exec(text); m; m = expects.exec(text)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0 || !LESS.test(text.slice(end + 1))) continue;
    if (!NON_TIMING_SUBJECT.test(text.slice(open + 1, end)))
      lines.push(text.slice(0, m.index).split('\n').length);
  }
  return lines;
}

/**
 * Benches of other leads' in-flight work packages (skipped by WP-913). Each entry leaves this list when its
 * package migrates the file; the list must be empty once they have landed.
 */
const PENDING_OTHER_LANES: readonly string[] = [];

function rawTimingAsserts(root: string, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const r = `${rel}${e.name}`;
      if (e.name === 'node_modules' || e.name === '.results' || isPlanted(r)) continue;
      if (e.isDirectory()) walk(join(dir, e.name), `${r}/`);
      else if (e.name.endsWith('.bench.ts') && !skip.some((s) => r.startsWith(s)))
        for (const line of rawLessLines(readFileSync(join(root, r), 'utf8'))) out.push(`${r}:${line}`);
    }
  };
  walk('bench', 'bench/');
  return out;
}

/** The 65 raw timing asserts WP-913 removed from the benches, verbatim. */
const REMOVED_BY_WP_913 = [
  'expect(ms).toBeLessThanOrEqual(50);',
  'expect(ms).toBeLessThanOrEqual(200);',
  'expect(ms).toBeLessThanOrEqual(20);',
  'expect(ms).toBeLessThanOrEqual(20);',
  'expect(ms).toBeLessThanOrEqual(300);',
  'expect(ms).toBeLessThanOrEqual(200);',
  'expect(ms).toBeLessThanOrEqual(200);',
  'expect(ms).toBeLessThanOrEqual(1000);',
  'expect(best).toBeLessThanOrEqual(200);',
  'expect(ms).toBeLessThanOrEqual(200);',
  'expect(p95).toBeLessThanOrEqual(10);',
  'expect(p95 * 4).toBeLessThanOrEqual(50);',
  'expect(worstPlan).toBeLessThan(100);',
  'expect(p95).toBeLessThanOrEqual(1);',
  'expect(worst * 4).toBeLessThanOrEqual(50);',
  'expect(buildMs * 4).toBeLessThanOrEqual(1000);',
  'expect(addMs * 4).toBeLessThanOrEqual(1);',
  'expect(ms).toBeLessThanOrEqual(200);',
  'expect(ms).toBeLessThanOrEqual(50);',
  'expect(ms).toBeLessThanOrEqual(5);',
  'expect(first).toBeLessThanOrEqual(2000);',
  'expect(second).toBeLessThanOrEqual(2000);',
  'expect(ms).toBeLessThan(2000);',
  'expect(worst).toBeLessThanOrEqual(5000);',
  'expect(ms * 4).toBeLessThanOrEqual(100);',
  'expect(ms * 4).toBeLessThanOrEqual(150);',
  'expect(p95).toBeLessThanOrEqual(100);',
  'expect(worst).toBeLessThanOrEqual(100);',
  'expect(Math.max(...samples.map((x) => x.total))).toBeLessThanOrEqual(250);',
  'expect(ms).toBeLessThanOrEqual(100);',
  'expect(perCall).toBeLessThan(1);',
  'expect(median).toBeLessThan(20);',
  'expect(worst).toBeLessThan(100);',
  'expect(total).toBeLessThan(5_000);',
  'expect(per).toBeLessThan(1);',
  'expect(ms).toBeLessThanOrEqual(2);',
  'expect(ms).toBeLessThanOrEqual(0.5);',
  'expect(ms).toBeLessThanOrEqual(300);',
  'expect(total).toBeLessThanOrEqual(2000);',
  'expect(ms).toBeLessThanOrEqual(20);',
  'expect(ms * 4).toBeLessThanOrEqual(1500);',
  'expect(median).toBeLessThanOrEqual(16);',
  'expect(build * 4).toBeLessThanOrEqual(1500);',
  'expect(longest * 4).toBeLessThanOrEqual(100);',
  'expect(longest).toBeLessThanOrEqual(25);',
  'expect(totalMs).toBeLessThanOrEqual(600_000);',
  'expect(ms).toBeLessThan(50);',
  'expect(ms).toBeLessThan(50);',
  'expect(ms).toBeLessThan(5);',
  'expect(ms).toBeLessThan(5);',
  'expect(ms).toBeLessThan(5);',
  'expect(ms).toBeLessThan(5);',
  'expect(l.worst * 4).toBeLessThanOrEqual(50);',
  'expect(w.p95 * 4).toBeLessThanOrEqual(50);',
  'expect(Math.max(from.p95, fromRel.p95, to.p95)).toBeLessThan(1);',
  'expect(nearP95).toBeLessThanOrEqual(2);',
  'expect(inverseP95).toBeLessThan(1);',
  'expect(lookup).toBeLessThan(1);',
  'expect(bbox).toBeLessThanOrEqual(100);',
  'expect(importMs).toBeLessThanOrEqual(30_000);',
  'expect(viewport).toBeLessThanOrEqual(100);',
  'expect(s).toBeLessThan(30);',
  'expect(s).toBeLessThan(60);',
  'expect(dec).toBeLessThan(100); // main-thread long task budget per page',
  'expect((dec + enc) * pages60k).toBeLessThan(20_000); // 60k snapshot budget, codec share',
];

describe('benches assert budgets only through the harness (WP-913)', () => {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'rawbench-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  // plants are skipped by the real scan, so the planted cases scan a plain name in the temp root
  const scanPlain = (src: string): number => {
    mkdirSync(join(tmp, 'bench/y'), { recursive: true });
    writeFileSync(join(tmp, 'bench/y/b.bench.ts'), src);
    return rawTimingAsserts(tmp).length;
  };

  it('flags a raw timing assert whatever the subject is called', () => {
    for (const src of [
      'expect(l.worst * 4).toBeLessThanOrEqual(50);',
      'expect(ms).toBeLessThan(5);',
      'expect(total).toBeLessThan(BUDGET_MS);',
      'expect(first).toBeLessThanOrEqual(2000);',
      'expect(worstPlan).toBeLessThan(100);',
      'expect((dec + enc) * pages60k).toBeLessThan(20_000);',
    ])
      expect(scanPlain(src + '\n'), src).toBe(1);
  });
  it('flags a prettier-wrapped multi-line expect', () => {
    expect(scanPlain('expect(\n  Math.max(a, b),\n).toBeLessThanOrEqual(\n  250,\n);\n')).toBe(1);
    expect(scanPlain('expect(\n  ms\n)\n  .toBeLessThan(5);\n')).toBe(1);
  });
  it('passes non-timing asserts, comments and assertBudget', () => {
    expect(scanPlain('expect(hits).toBeGreaterThan(0);\nexpect(maxHits).toBeLessThanOrEqual(50);\n')).toBe(0);
    expect(scanPlain('expect(mb).toBeLessThanOrEqual(60);\nexpect(rssMb).toBeLessThan(9);\n')).toBe(0);
    expect(scanPlain('// expect(ms).toBeLessThan(5)\nassertBudget(report(b, ms));\n')).toBe(0);
  });
  it('flags every one of the 65 asserts WP-913 removed', () => {
    expect(REMOVED_BY_WP_913).toHaveLength(65);
    const missed = REMOVED_BY_WP_913.filter((l) => scanPlain(l + '\n') !== 1);
    expect(missed).toEqual([]);
  });
  it('ignores plants like the other guardrails', () => {
    const p = plant(tmp, { 'bench/x/raw.planted.bench.ts': 'expect(ms).toBeLessThan(5);\n' });
    try {
      expect(rawTimingAsserts(tmp).filter((f) => f.includes('planted'))).toEqual([]);
    } finally {
      p.remove();
    }
  });
  it('main has no raw timing assert in a bench, except the other lanes in flight', () => {
    expect(rawTimingAsserts(repo, PENDING_OTHER_LANES)).toEqual([]);
  });
});
