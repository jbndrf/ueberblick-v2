import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countLines, findViolations, isChecked } from './max-lines.mjs';
import { specEnv } from '../testing/spec-env.mjs';

// WP-974: R8's 400-line limit for .svelte files, which ESLint does not lint.
const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`).join('\n') + '\n';

describe('findViolations', () => {
  it('fails a 401-line .svelte file and passes a 400-line one', () => {
    const files: Record<string, string> = { 'a/Big.svelte': lines(401), 'a/Ok.svelte': lines(400) };
    expect(findViolations(Object.keys(files), (p) => files[p] ?? '')).toEqual([
      'a/Big.svelte: 401 lines (R8: max 400)',
    ]);
  });
  it('ignores reference/, paraglide and build output', () => {
    for (const p of [
      'reference/x/A.svelte',
      'packages/ui/src/paraglide/A.svelte',
      'apps/web/.svelte-kit/A.svelte',
      'apps/web/build/A.svelte',
    ])
      expect(isChecked(p)).toBe(false);
    expect(isChecked('packages/ui/src/A.svelte')).toBe(true);
    expect(isChecked('packages/ui/src/a.ts')).toBe(false);
  });
  it('counts lines like ESLint', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(2);
  });
});

describe('max-lines.mjs', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maxlines-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const run = () =>
    spawnSync('node', [resolve(__dirname, 'max-lines.mjs')], { cwd: dir, encoding: 'utf8', env: specEnv() });
  const git = (...a: string[]) => spawnSync('git', a, { cwd: dir, env: specEnv() });

  it('names the file and count and exits 1; exits 0 when within the limit', () => {
    git('init', '-q');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/Ok.svelte'), lines(400));
    git('add', '.');
    expect(run().status).toBe(0);
    writeFileSync(join(dir, 'src/Big.svelte'), lines(401));
    git('add', '.');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('src/Big.svelte: 401 lines (R8: max 400)');
  });
});
