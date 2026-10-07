// WP-1019: which e2e specs a train's changes select, the 10 minute budget and the quarantine. The selection runs on a small
// throwaway repository that has the shape of the real one (routes, lib, e2e dirs), so no real e2e runs here.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import {
  judge,
  loadQuarantine,
  validateQuarantine,
  // @ts-expect-error plain .mjs without declarations
} from './affected-quarantine.mjs';
import {
  BUDGET_MS,
  fitBudget,
  itemsOf,
  pathsIn,
  selectAffected,
  visits,
  // @ts-expect-error plain .mjs without declarations
} from './affected.mjs';
// @ts-expect-error plain .mjs without declarations
import { parseArgs } from './run.mjs';

interface Suite {
  id: string;
  name: string;
  config: string;
  report: string;
}
interface Pick {
  suite: Suite;
  files: string[] | null;
  why: Record<string, string>;
}
type Select = (
  cwd: string,
  files: string[],
  deleted: string[],
  suites: Suite[],
  opts?: { base?: string | null },
) => { suites: Pick[]; lines: string[] };
const select = selectAffected as Select;

const SUITES: Suite[] = [
  { id: 'apps-web', name: 'apps/web', config: 'apps/web/playwright.config.ts', report: 'r1.json' },
  { id: 'journeys', name: 'e2e/journeys', config: 'e2e/journeys/playwright.config.ts', report: 'r2.json' },
  {
    id: 'comp:web/lib-widget',
    name: 'apps/web/src/lib/widget',
    config: 'apps/web/src/lib/widget/e2e/playwright.config.ts',
    report: 'r3.json',
  },
];
const FILES: Record<string, string> = {
  'package.json': '{"name":"r","workspaces":["apps/*"]}',
  'apps/web/package.json': '{"name":"@ueberblick/web","scripts":{"a":"b"}}',
  'apps/web/playwright.config.ts': 'export default {};',
  'apps/web/src/routes/+layout.svelte': '<slot />',
  'apps/web/src/routes/(admin)/admin/data/+page.svelte':
    '<script>\nimport T from "$lib/admin/data/Table.svelte";\n</script>\n<T />',
  'apps/web/src/routes/(admin)/admin/other/+page.svelte': '<p>other</p>',
  'apps/web/src/lib/admin/data/Table.svelte': '<table />',
  'apps/web/src/lib/widget/Widget.svelte': '<b />',
  'apps/web/src/lib/widget/e2e/playwright.config.ts': 'export default {};',
  'apps/web/src/lib/widget/e2e/harness.ts': 'import W from "../Widget.svelte"; export { W };',
  'apps/web/src/lib/widget/e2e/w.e2e.ts': 'import { W } from "./harness"; void W;',
  'apps/web/e2e/data.spec.ts': "await page.goto('/admin/data');",
  'apps/web/e2e/other.spec.ts': 'await page.goto(`/admin/other?x=${1}`);',
  'apps/web/e2e/support/world.ts': 'export const w = 1;',
  'e2e/journeys/j.spec.ts': "await page.goto('/admin/data');",
  'packages/core/src/rule.ts': 'export const rule = 1;',
  'scripts/tool.mjs': 'export {};',
  'docs/a.md': '# a',
};
let cwd: string;
const sel = (files: string[], deleted: string[] = []) => select(cwd, files, deleted, SUITES);
const specsOf = (r: ReturnType<Select>, id: string) => r.suites.find((s) => s.suite.id === id)?.files ?? [];

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'affected-'));
  for (const [f, text] of Object.entries(FILES)) {
    mkdirSync(join(cwd, f, '..'), { recursive: true });
    writeFileSync(join(cwd, f), text);
  }
  execFileSync('git', ['init', '-q'], { cwd, env: specEnv() });
  execFileSync('git', ['add', '-A'], { cwd, env: specEnv() });
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe('the selection (WP-1019)', () => {
  it('a route file selects the specs that visit that route, in every suite', () => {
    const r = sel(['apps/web/src/routes/(admin)/admin/data/+page.svelte']);
    expect(specsOf(r, 'apps-web')).toEqual(['data.spec.ts']);
    expect(specsOf(r, 'journeys')).toEqual(['j.spec.ts']);
    expect(r.lines.join('\n')).toContain('visits /admin/data');
  });

  it('a lib file reaches the route that imports it and selects that route’s specs', () => {
    const r = sel(['apps/web/src/lib/admin/data/Table.svelte']);
    expect(specsOf(r, 'apps-web')).toEqual(['data.spec.ts']);
  });

  it('a changed spec selects itself', () => {
    const r = sel(['apps/web/e2e/other.spec.ts']);
    expect(specsOf(r, 'apps-web')).toEqual(['other.spec.ts']);
    expect(specsOf(r, 'journeys')).toEqual([]);
  });

  it('a suite config selects its whole suite, a support file too', () => {
    const all = ['data.spec.ts', 'other.spec.ts'];
    expect(specsOf(sel(['apps/web/playwright.config.ts']), 'apps-web')).toEqual(all);
    expect(specsOf(sel(['apps/web/e2e/support/world.ts']), 'apps-web')).toEqual(all);
    expect(specsOf(sel(['apps/web/playwright.config.ts']), 'journeys')).toEqual([]);
  });

  it('a file that no route or spec reaches, and a scripts file, select nothing', () => {
    expect(sel(['scripts/tool.mjs', 'docs/a.md']).suites).toEqual([]);
    expect(sel([]).lines).toEqual(['e2e affected: no spec is affected by these changes']);
  });

  it('a change in an engine package runs the smoke spec of each fixed suite, not every route', () => {
    const r = sel(['packages/core/src/rule.ts']);
    expect(specsOf(r, 'apps-web')).toHaveLength(1);
    expect(specsOf(r, 'journeys')).toHaveLength(1);
    expect(r.suites.find((x) => x.suite.id === 'apps-web')?.why[specsOf(r, 'apps-web')[0] ?? '']).toContain(
      'smoke',
    );
  });

  it('a component suite is selected as a whole when its harness reaches the changed file', () => {
    const r = sel(['apps/web/src/lib/widget/Widget.svelte']);
    expect(r.suites.map((s) => [s.suite.id, s.files])).toEqual([['comp:web/lib-widget', null]]);
  });

  it('a lockfile change is app-wide: every route', () => {
    const r = sel(['package-lock.json']);
    expect(specsOf(r, 'apps-web')).toEqual(['data.spec.ts', 'other.spec.ts']);
    expect(r.lines[0]).toContain('is app-wide');
  });

  it('the runner files select every fixed suite and say why', () => {
    const r = sel(['scripts/e2e/shards.mjs']);
    expect(r.suites.map((s) => s.suite.id)).toEqual(['apps-web', 'journeys']);
    expect(r.lines.join('\n')).toContain('changes how e2e runs');
  });
});

describe('route matching', () => {
  const lit = (p: string) => pathsIn(`goto('${p}')`)[0];
  it('matches params and template holes, exact length otherwise', () => {
    expect(visits(['admin', '[key]', 'data'], lit('/admin/${k}/data'))).toBe(true);
    expect(visits(['admin', 'data'], lit('/admin/data'))).toBe(true);
    expect(visits(['admin', 'data', 'x'], lit('/admin/data'))).toBe(false);
    expect(visits(['admin'], lit('/admin/data'))).toBe(false);
    // five or more segments deep also covers the pages below it (a spec that opens a feature clicks on to its run page)
    expect(visits(['a', 'b', '[c]', 'd', '[e]', 'run'], lit('/a/b/${c}/d/${e}'))).toBe(true);
    expect(visits(['a', 'b', '[c]', 'd', 'run'], lit('/a/b/${c}/d'))).toBe(false);
  });
  it('a literal ending in / is a prefix; an e2e-covers header names routes', () => {
    expect(visits(['api', 'p', '[k]', 'runs'], lit('/api/p/'))).toBe(true);
    expect(
      (pathsIn('// e2e-covers: /admin/data, /map\n') as { segs: string[] }[]).map((l) => l.segs.join('/')),
    ).toEqual(['admin/data', 'map']);
  });
});

describe('the 10 minute budget', () => {
  const s = { id: 'x' };
  const items = [30, 20, 10, 5, 4, 3].map((m, i) => ({ suite: s, file: `f${i}`, ms: m * 60_000 }));
  it('runs slowest first until the budget is used and returns what it skipped', () => {
    const fit = fitBudget(items, 4);
    expect(fit.run.map((i: { file: string }) => i.file)).toEqual(['f0', 'f2']);
    expect(fit.skipped.map((i: { file: string }) => i.file)).toEqual(['f1', 'f3', 'f4', 'f5']);
    expect(fit.estimateMs).toBeLessThanOrEqual(BUDGET_MS);
  });
  it('never drops an item silently: run + skipped is the input, the estimate stays in budget', () => {
    for (const k of [1, 2, 4]) {
      const fit = fitBudget(items, k);
      expect(fit.run.length + fit.skipped.length).toBe(items.length);
      expect(fit.estimateMs).toBeLessThanOrEqual(BUDGET_MS);
    }
  });
  it('weighs a file with no history as the suite’s mean file', () => {
    const [a, b] = itemsOf([{ suite: s, files: ['known', 'new'] }], () => ({ known: 1000, other: 3000 }));
    expect([a.ms, b.ms]).toEqual([1000, 2000]);
  });
});

describe('the quarantine', () => {
  const entry = {
    suite: 'apps-web',
    file: 'apps/web/e2e/a.spec.ts',
    line: 7,
    lane: 'lead-a',
    since: '2026-10-04',
  };
  it('needs a lane, a date and a line', () => {
    expect(validateQuarantine([entry])).toEqual([]);
    expect(validateQuarantine([{ ...entry, lane: 'nobody' }])[0]).toContain('lane');
    expect(validateQuarantine([{ ...entry, since: 'yesterday' }])[0]).toContain('date');
    expect(validateQuarantine([{ ...entry, line: undefined }])[0]).toContain('line');
  });
  const suite = { id: 'apps-web', name: 'apps/web', config: 'apps/web/playwright.config.ts' };
  const report = (status: string) => ({
    suites: [{ specs: [{ file: 'a.spec.ts', line: 7, tests: [{ status }] }] }],
  });
  const run = (status: string, q = [entry], exists = () => true) =>
    (
      judge as (
        r: unknown,
        q: unknown,
        e: () => boolean,
      ) => { failed: string[]; quarantined: string[]; stale: string[] }
    )([{ suite, report: report(status) }], q, exists);
  it('a red test the list names does not fail the suite; an unnamed one does', () => {
    expect(run('unexpected').failed).toEqual([]);
    expect(run('unexpected').quarantined[0]).toContain('lead-a, since 2026-10-04');
    expect(run('unexpected', []).failed[0]).toContain('apps/web/e2e/a.spec.ts:7');
  });
  it('reports a stale entry: the spec is green now, or the file is gone', () => {
    expect(run('expected').stale[0]).toContain('green now');
    expect(run('unexpected', [entry], () => false).stale[0]).toContain('the file is gone');
  });
  const verdict = (report: unknown, code: number | undefined, q = [entry]) =>
    (judge as (r: unknown, q: unknown) => { failed: string[] })([{ suite, report, code }], q).failed;
  it('infrastructure failures are red: report errors, an unexplained non-zero exit, an empty report', () => {
    expect(verdict({ suites: [], errors: [{ message: 'webServer timed out' }] }, 1)[0]).toContain(
      'webServer',
    );
    expect(verdict({ suites: [], errors: [{ message: 'global setup failed' }] }, 0)).toHaveLength(1);
    expect(verdict({ suites: [] }, 1)[0]).toContain('exit 1');
    expect(verdict({ suites: [], stats: { unexpected: 2 } }, 1)[0]).toContain('not attributed');
    expect(verdict({ suites: [], stats: {} }, 0)).toEqual([]);
  });
  it('exit 1 with only quarantined reds is not red', () => {
    expect(verdict(report('unexpected'), 1)).toEqual([]);
    expect(verdict(report('unexpected'), 1, [])).toHaveLength(1);
  });
  it('a suite without a report is red', () => {
    const j = (judge as (r: unknown, q: unknown) => { failed: string[] })([{ suite, report: null }], []);
    expect(j.failed).toEqual(['apps/web (no report)']);
  });
});

describe('npm run e2e -- --affected', () => {
  it('parseArgs takes the base and keeps the other arguments', () => {
    expect(parseArgs(['--affected', 'abc', '--suite', 'a11y', '-g', 'x'])).toEqual({
      names: ['a11y'],
      rest: ['-g', 'x'],
      affected: 'abc',
    });
    expect(() => parseArgs(['--affected'])).toThrow(/needs a base/);
  });
});

describe('scripts/e2e/quarantine.json', () => {
  const root = resolve(__dirname, '..', '..');
  const entries = (loadQuarantine as (r: string) => { file: string; line: number }[])(root);
  it('is valid: every entry has a suite, a spec, a line, a lane and a date', () => {
    expect((validateQuarantine as (l: unknown) => string[])(entries)).toEqual([]);
  });
  it('names no file that is gone (a stale entry is deleted with its fix)', () => {
    for (const e of entries) expect(existsSync(join(root, e.file)), e.file).toBe(true);
  });
});
