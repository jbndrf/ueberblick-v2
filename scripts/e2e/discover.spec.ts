import { mkdirSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without declarations
import { discoverSuites, portEnvFor, reportTargets } from './discover.mjs';
// @ts-expect-error plain .mjs runner without declarations
import { SUITES, allSuites, assignRun, parseArgs, selectSuites, varsFor } from './run.mjs';
// @ts-expect-error plain .mjs without declarations
import { phoneAndDesktop } from './component-config.mjs';

interface Suite {
  id: string;
  name: string;
  config: string;
  report: string;
}
interface Device {
  name: string;
  use: { viewport: { width: number; height: number }; hasTouch?: boolean; isMobile?: boolean };
}
const discover = discoverSuites as (root: string) => Suite[];
const all = allSuites as (root: string) => Suite[];
const fixed = SUITES as Suite[];

function tree(...dirs: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'ueb-discover-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ workspaces: ['packages/*', 'packages/tools/*', 'apps/*'] }),
  );
  for (const d of dirs) {
    mkdirSync(join(root, d, 'e2e'), { recursive: true });
    writeFileSync(join(root, d, 'e2e', 'playwright.config.ts'), 'export default {};\n');
  }
  return root;
}
const MOBILE = 'packages/ui/src/components/mobile-select';
const BUILDER = 'packages/builder/src/panels';

describe('discoverSuites', () => {
  it('finds component configs, sorted, with id, config and report', () => {
    const got = discover(tree(MOBILE, BUILDER));
    expect(got.map((s) => s.id)).toEqual(['comp:builder/panels', 'comp:ui/components-mobile-select']);
    expect(got[1]).toEqual({
      id: 'comp:ui/components-mobile-select',
      name: MOBILE,
      config: `${MOBILE}/e2e/playwright.config.ts`,
      report: 'apps/web/test-results/e2e-comp-ui-components-mobile-select-report.json',
    });
  });
  it('finds suites under apps/*/src too', () => {
    const ACT = 'apps/web/src/lib/participant/feature/activity';
    const got = discover(tree(MOBILE, ACT));
    expect(got.map((s) => s.id)).toEqual([
      'comp:ui/components-mobile-select',
      'comp:web/lib-participant-feature-activity',
    ]);
    expect(got[1]).toMatchObject({ name: ACT, config: `${ACT}/e2e/playwright.config.ts` });
  });
  it('finds tool plug-in suites under packages/tools/*/src, with a tools- id stem', () => {
    const FILE = 'packages/tools/file/src';
    const got = discover(tree(FILE));
    expect(got).toEqual([
      {
        id: 'comp:tools-file',
        name: FILE,
        config: `${FILE}/e2e/playwright.config.ts`,
        report: 'apps/web/test-results/e2e-comp-tools-file-report.json',
      },
    ]);
    expect(portEnvFor('comp:tools-file')).toEqual({
      port: 'E2E_COMP_TOOLS_FILE_PORT',
      dir: 'E2E_COMP_TOOLS_FILE_DATA_DIR',
    });
  });
  it('refuses a workspaces glob it cannot read', () => {
    const root = mkdtempSync(join(tmpdir(), 'ueb-discover-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/**'] }));
    expect(() => discover(root)).toThrow('unsupported workspaces glob');
  });
  it('returns [] when there is none', () => {
    expect(discover(tree())).toEqual([]);
    expect(discover(mkdtempSync(join(tmpdir(), 'ueb-discover-')))).toEqual([]);
  });
  it('ignores an e2e directory without a config', () => {
    const root = tree();
    mkdirSync(join(root, MOBILE, 'e2e'), { recursive: true });
    expect(discover(root)).toEqual([]);
  });
});

describe('allSuites and selection', () => {
  const root = tree(MOBILE, BUILDER);
  const both = ['comp:builder/panels', 'comp:ui/components-mobile-select'];
  const pick = (argv: string[]) => {
    const { names } = (parseArgs as (a: string[]) => { names: string[] })(argv);
    return (selectSuites as (s: Suite[], n: string[]) => Suite[])(all(root), names).map((s) => s.id);
  };
  it('is the fixed suites then the discovered ones', () => {
    const ids = all(root).map((s) => s.id);
    expect(ids.slice(0, fixed.length)).toEqual(fixed.map((s) => s.id));
    expect(ids.slice(fixed.length)).toEqual(both);
  });
  it('--suite components selects all discovered, none of the fixed', () => {
    expect(pick(['--suite', 'components'])).toEqual(both);
  });
  it('--suite comp:<id> selects one', () => {
    expect(pick(['--suite', 'comp:ui/components-mobile-select'])).toEqual([
      'comp:ui/components-mobile-select',
    ]);
  });
  it('errors on an unknown component id', () => {
    expect(() => pick(['--suite', 'comp:ui/nope'])).toThrow(/unknown suite comp:ui\/nope/);
  });
});

describe('assignRun for discovered suites', () => {
  it('gives each a distinct port and data dir under id-derived names', () => {
    const suites = discover(tree(MOBILE, BUILDER));
    const base = mkdtempSync(join(tmpdir(), 'ueb-run-'));
    const runs = (assignRun as (s: Suite[], b: string, p: number[]) => { env: Record<string, string> }[])(
      suites,
      base,
      [5001, 5002],
    );
    const mobile = portEnvFor('comp:ui/components-mobile-select') as { port: string; dir: string };
    const builder = portEnvFor('comp:builder/panels') as { port: string; dir: string };
    expect(mobile.port).toBe('E2E_COMP_UI_COMPONENTS_MOBILE_SELECT_PORT');
    expect(runs[0]?.env[builder.port]).toBe('5001');
    expect(runs[1]?.env[mobile.port]).toBe('5002');
    expect(runs[0]?.env[builder.dir]).not.toBe(runs[1]?.env[mobile.dir]);
  });
  it('a fixed suite still gets its four server pairs', () => {
    expect((varsFor as (s: Suite) => unknown[])(fixed[0] as Suite)).toHaveLength(4);
  });
});

describe('triage targets', () => {
  it('include discovered suites with their report paths', () => {
    const root = tree(MOBILE);
    const t = (reportTargets as (s: Suite[], r: string) => { suite: string; path: string }[])(
      all(root),
      root,
    );
    expect(t.at(-1)).toEqual({
      suite: MOBILE,
      path: join(root, 'apps/web/test-results/e2e-comp-ui-components-mobile-select-report.json'),
    });
  });
});

describe('phoneAndDesktop', () => {
  it('is the one source: the journeys config uses it', () => {
    const src = readFileSync(new URL('../../e2e/journeys/playwright.config.ts', import.meta.url), 'utf8');
    expect(src).toContain('projects: phoneAndDesktop()');
  });
  it('is the phone (below 768 px, touch) and desktop (1280x800) projects', () => {
    const [phone, desktop] = (phoneAndDesktop as () => Device[])();
    expect(phone?.name).toBe('phone');
    expect(phone?.use.viewport.width).toBeLessThan(768);
    expect(phone?.use.hasTouch).toBe(true);
    expect(phone?.use.isMobile).toBe(true);
    expect(desktop?.name).toBe('desktop');
    expect(desktop?.use.viewport).toEqual({ width: 1280, height: 800 });
  });
});
