import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { specEnv } from './testing/spec-env.mjs';

// WP-931: ESLint and Prettier run with a content-hash cache (warm runs skip unchanged files), and a
// warm cache still reports a violation in a changed file. ESLint runs single-threaded: its worker pool
// cost more than it saved (Log). Each tool is run on a scratch directory with the real script's flags.
const root = fileURLToPath(new URL('..', import.meta.url));
const scripts = (
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
).scripts;
/** The flags of a package.json script: its words after the command name, minus the file globs. */
const flags = (script: string): string[] =>
  script
    .split(' ')
    .slice(1)
    .filter((w) => w.startsWith('--'));

describe('lint caches (WP-931)', () => {
  it('eslint and prettier use a content cache, eslint without a worker pool', () => {
    expect(flags(scripts['lint:eslint'] ?? '')).toEqual(
      expect.arrayContaining(['--cache', '--cache-strategy', '--concurrency=off', '--cache-location']),
    );
    expect(scripts['lint:eslint']).toContain('node_modules/.cache/eslint/');
    expect(scripts['lint:prettier']).toContain('--cache --cache-strategy content');
    // WP-938: a Prettier run without --cache deletes the *default* cache file (guardrails.spec, agents'
    // `npx prettier --write`), so lint:prettier and format keep theirs at their own location.
    expect(scripts['lint:prettier']).toContain(
      '--cache-location node_modules/.cache/prettier-lint/cache.json',
    );
    expect(scripts['format']).toContain('--cache-location node_modules/.cache/prettier-lint/cache.json');
  });

  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lint-cache-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${dir}-eslintcache`, { recursive: true, force: true });
  });

  const tool = (bin: string, args: string[]) =>
    spawnSync(join(root, 'node_modules/.bin', bin), args, { cwd: dir, encoding: 'utf8', env: specEnv() });

  it('a warm eslint cache still fails on a violation in a changed file', () => {
    writeFileSync(join(dir, 'eslint.config.mjs'), "export default [{ rules: { 'no-var': 'error' } }];\n");
    writeFileSync(join(dir, 'a.js'), 'let a = 1;\nexport { a };\n');
    // The real script's words, with the cache moved next to (not into) the linted directory.
    const cache = `${dir}-eslintcache/`;
    const args = (scripts['lint:eslint'] ?? '')
      .split(' ')
      .slice(1)
      .map((w) => (w === 'node_modules/.cache/eslint/' ? cache : w));
    const cold = tool('eslint', args);
    expect(cold.status, cold.stdout + cold.stderr).toBe(0);
    writeFileSync(join(dir, 'a.js'), 'var a = 1;\nexport { a };\n');
    const warm = tool('eslint', args);
    expect(warm.status).not.toBe(0);
    expect(warm.stdout).toContain('no-var');
  }, 60_000);

  it('a config change invalidates a warm eslint cache for unchanged files', () => {
    writeFileSync(join(dir, 'eslint.config.mjs'), "export default [{ rules: { 'no-var': 'error' } }];\n");
    writeFileSync(join(dir, 'a.js'), 'let a = 1;\nconsole.log(a);\nexport { a };\n');
    const cache = `${dir}-eslintcache/`;
    const args = (scripts['lint:eslint'] ?? '')
      .split(' ')
      .slice(1)
      .map((w) => (w === 'node_modules/.cache/eslint/' ? cache : w));
    expect(tool('eslint', args).status).toBe(0);
    writeFileSync(join(dir, 'eslint.config.mjs'), "export default [{ rules: { 'no-console': 'error' } }];\n");
    const warm = tool('eslint', args);
    expect(warm.status).not.toBe(0);
    expect(warm.stdout).toContain('no-console');
  }, 60_000);

  it('a plain prettier run (no --cache) leaves the lint cache at its own location alone (WP-938)', () => {
    writeFileSync(join(dir, 'a.ts'), 'export const a = "a";\n'); // Prettier defaults: no config here
    const cacheFile = join(dir, 'lint-cache', 'cache.json');
    const cached = [
      '--check',
      '--cache',
      '--cache-strategy',
      'content',
      '--cache-location',
      cacheFile,
      'a.ts',
    ];
    expect(tool('prettier', cached).status).toBe(0);
    expect(existsSync(cacheFile)).toBe(true);
    expect(tool('prettier', ['--check', 'a.ts']).status).toBe(0);
    expect(existsSync(cacheFile)).toBe(true);
  }, 60_000);

  it('a warm prettier cache still fails on a format violation in a changed file', () => {
    writeFileSync(join(dir, 'a.ts'), 'export const a = "a";\n'); // Prettier defaults: no config here
    const args = ['--check', '--cache', '--cache-strategy', 'content', 'a.ts'];
    const cold = tool('prettier', args);
    expect(cold.status, cold.stdout + cold.stderr).toBe(0);
    writeFileSync(join(dir, 'a.ts'), 'export const a   =   "a"\n');
    const warm = tool('prettier', args);
    expect(warm.status).not.toBe(0);
  }, 60_000);

  it('no spec runs prettier without its own --cache-location (WP-939)', () => {
    const specs = spawnSync('git', ['ls-files', '*.spec.ts', '*.spec.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: specEnv(),
    })
      .stdout.split('\n')
      .filter(Boolean);
    const bare = specs.flatMap((f) =>
      readFileSync(join(root, f), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*)/.test(l)) // comments may name the command
        .filter((l) => /npx prettier\b/.test(l) && !l.includes('--cache-location'))
        .map((l) => `${f}: ${l.trim()}`),
    );
    expect(bare).toEqual([]);
  });
});
