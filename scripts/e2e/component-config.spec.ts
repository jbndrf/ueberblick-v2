// Component Playwright configs read their port and output dir from the runner's derived env (WP-1016).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without declarations
import { PARAGLIDE_DONE_VAR, componentRun, harnessCacheDir, paraglideStep } from './component-config.mjs';
import { isPlanted } from '../testing/plant.mjs';
// @ts-expect-error plain .mjs without declarations
import { discoverSuites, portEnvFor } from './discover.mjs';

interface Suite {
  id: string;
  config: string;
}
const ROOT = join(__dirname, '..', '..');
const run = componentRun as (
  id: string,
  fallback: number,
  env?: Record<string, string>,
) => { port: number; outputDir: string };
const suites = discoverSuites(ROOT) as Suite[];

describe('componentRun', () => {
  const { port: portVar, dir: dirVar } = portEnvFor('comp:ui/map-draw') as { port: string; dir: string };
  it('reads the port from the env var portEnvFor derives, else the fallback', () => {
    expect(run('comp:ui/map-draw', 4182, { [portVar]: '5555' }).port).toBe(5555);
    expect(run('comp:ui/map-draw', 4182, {}).port).toBe(4182);
  });
  it('puts the output under the per-run data dir, else keeps the default dir', () => {
    expect(run('comp:ui/map-draw', 4182, { [dirVar]: '/tmp/x' }).outputDir).toBe('/tmp/x/test-results');
    expect(run('comp:ui/map-draw', 4182, {}).outputDir).toBe('test-results');
  });
});

describe('paraglideStep', () => {
  const step = paraglideStep as (env: Record<string, string>) => string;
  it('compiles the catalogue unless the runner already did', () => {
    expect(step({})).toMatch(/^npx paraglide-js compile .* && $/);
    expect(step({ [PARAGLIDE_DONE_VAR as string]: '1' })).toBe('');
  });
});

describe('every component config', () => {
  it('finds the component suites', () => expect(suites.length).toBeGreaterThan(10));
  it.each(suites.map((s) => [s.id, s.config]))(
    '%s: derived port and output dir, no own env or literal',
    (id, config) => {
      const src = readFileSync(join(ROOT, config), 'utf8');
      expect(src).toContain(`componentRun('${id}'`);
      expect(src).toMatch(/\boutputDir,/);
      expect(src).not.toMatch(/process\.env/);
      expect(src).not.toContain('paraglide-js compile');
      expect(src).not.toMatch(/outputDir:\s*['"`]/);
    },
  );
});

describe('harnessCacheDir (WP-1040)', () => {
  const dirOf = harnessCacheDir as (url: string, env?: Record<string, string | undefined>) => string;
  const at = (rel: string, env: Record<string, string | undefined> = {}) =>
    dirOf(pathToFileURL(join(ROOT, rel, 'vite.config.ts')).href, env);
  it("inside a runner copy (shard), it is that copy's private data dir, so two servers never share one", () => {
    const shard = (dir: string) => ({ E2E_COMP_WEB_LIB_PARTICIPANT_CREATE_DATA_DIR: dir });
    const a = at('apps/web/src/lib/participant/create/e2e', shard('/tmp/run/create-shards/s1'));
    const b = at('apps/web/src/lib/participant/create/e2e', shard('/tmp/run/create-shards/s2'));
    expect(a).toBe('/tmp/run/create-shards/s1/vite-cache');
    expect(b).not.toBe(a);
  });
  it('is distinct per harness and stable for the same one', () => {
    expect(at('apps/web/src/lib/participant/shell/e2e')).not.toBe(
      at('apps/web/src/lib/participant/info-pages/e2e'),
    );
    expect(at('apps/web/src/lib/participant/shell/e2e')).toBe(at('apps/web/src/lib/participant/shell/e2e'));
  });
  it('stays inside the repo node_modules', () => {
    expect(at('packages/ui/src/form/e2e').startsWith(join(ROOT, 'node_modules') + '/')).toBe(true);
    expect(at('packages/ui/src/form/e2e')).not.toContain('..');
  });
});

const harnesses = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (isPlanted(p) || e.name === 'node_modules' || e.name.startsWith('.')) return [];
    if (e.isDirectory()) return harnesses(p);
    return e.name === 'vite.config.ts' && dir.endsWith('/e2e') ? [p] : [];
  });

describe('every harness vite.config.ts', () => {
  const found = harnesses(ROOT);
  it('finds the harnesses', () => expect(found.length).toBeGreaterThan(10));
  it.each(found.map((f) => [f.slice(ROOT.length + 1), f]))(
    '%s: cacheDir comes from harnessCacheDir',
    (_n, f) => {
      expect(readFileSync(f, 'utf8')).toContain('cacheDir: harnessCacheDir(import.meta.url)');
    },
  );
});
