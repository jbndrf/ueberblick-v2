import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conflictMarkerLine, conflictViolation, plan, referenceViolation, userDocs } from './precommit.mjs';
import { specEnv } from '../testing/spec-env.mjs';

// WP-977 hotfix: the shared hook's ui-strings check reads the staged user docs only, so a rule added on main never
// fails an older worktree for a doc it did not touch.
describe('userDocs', () => {
  it('keeps staged docs/user Markdown and nothing else', () => {
    expect(
      userDocs(['docs/user/a.md', 'docs/user/x/b.en.md', 'docs/process/c.md', 'src/a.ts', 'docs/user/i.png']),
    ).toEqual(['docs/user/a.md', 'docs/user/x/b.en.md']);
  });
});

// WP-953: the pre-commit hook checks only what is staged and never runs the typecheck.
describe('plan', () => {
  it('sends only staged files to prettier and eslint, by the same globs as the full lint', () => {
    const p = plan([
      'packages/core/src/a.ts',
      'packages/ui/src/B.svelte',
      'apps/web/src/x.json',
      'scripts/ops/y.mjs',
      'package.json',
      'docs/process/z.md',
      'work/WP-1.md',
      'reference/v3/a.ts',
      'fixtures/golden/q.json',
    ]);
    expect(p.prettier).toEqual([
      'packages/core/src/a.ts',
      'packages/ui/src/B.svelte',
      'apps/web/src/x.json',
      'scripts/ops/y.mjs',
      'package.json',
    ]);
    expect(p.eslint).toEqual(['packages/core/src/a.ts', 'packages/ui/src/B.svelte', 'scripts/ops/y.mjs']);
  });
  it('sends .mts and .cts (declaration files too) to eslint, as the full eslint . does', () => {
    expect(plan(['scripts/metrics/r.d.mts', 'packages/core/src/a.cts']).eslint).toEqual([
      'scripts/metrics/r.d.mts',
      'packages/core/src/a.cts',
    ]);
  });
  it('an empty or docs-only commit has nothing to lint', () => {
    expect(plan([])).toEqual({ prettier: [], eslint: [] });
    expect(plan(['docs/a.md'])).toEqual({ prettier: [], eslint: [] });
  });
  it('never typechecks', () => {
    expect(readFileSync(resolve(__dirname, 'precommit.mjs'), 'utf8')).not.toMatch(
      /svelte-check|'tsc'|steps\.mjs/,
    );
    expect(readFileSync(resolve(__dirname, '../../.githooks/pre-commit'), 'utf8')).not.toMatch(
      /npm run|check:fast:run/,
    );
  });
});

describe('referenceViolation', () => {
  it('flags staged paths under reference/', () => {
    expect(referenceViolation(['a.ts', 'reference/x/y.ts'])).toBe('reference/x/y.ts');
    expect(referenceViolation(['a.ts', 'references.md'])).toBeNull();
  });
});

describe('cli', () => {
  const script = resolve(__dirname, 'precommit.mjs');
  const run = (files: string[], cwd: string) =>
    spawnSync('node', [script, '--files', ...files], {
      cwd,
      encoding: 'utf8',
      env: specEnv({ UEB_PRECOMMIT_SKIP_LINT: '1' }),
    });
  it('exits 1 on a reference/ file and 0 on nothing to check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'precommit-'));
    try {
      mkdirSync(join(dir, 'reference'));
      writeFileSync(join(dir, 'reference/a.ts'), '');
      const r = run(['reference/a.ts'], dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('reference/ is read-only');
      expect(run(['docs/a.md'], dir).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// WP-977: a failed conflict resolution was committed twice with its markers.
describe('conflict markers', () => {
  const L = (c: string, n: number, rest = '') => c.repeat(n) + rest;
  const marked = ['ok', L('<', 7, ' HEAD'), 'a', L('=', 7), 'b', L('>', 7, ' branch'), 'z'].join('\n');

  it('finds the opening marker line', () => {
    expect(conflictMarkerLine(marked)).toBe(2);
    expect(conflictMarkerLine([L('<', 7), 'a'].join('\n'))).toBe(1);
    expect(conflictMarkerLine(['a', L('>', 7, ' x')].join('\n'))).toBe(2);
  });
  it('does not flag setext headings, table rules, longer rules or inline text', () => {
    expect(conflictMarkerLine(['Title', L('=', 7), '', 'Next', L('=', 20)].join('\n'))).toBeNull();
    expect(conflictMarkerLine(['| a | b |', '|---|---|', 'x <<<<<<< y'].join('\n'))).toBeNull();
    expect(conflictMarkerLine([L('<', 8, ' x'), L('<', 6, ' x'), L('>', 7)].join('\n'))).toBeNull();
    expect(conflictMarkerLine('')).toBeNull();
  });
  it('conflictViolation names file:line and skips binary files', () => {
    const files: Record<string, string | null> = { 'a.md': 'fine', 'b.md': marked, 'c.png': null };
    expect(conflictViolation(['a.md', 'c.png', 'b.md'], (f) => files[f] ?? null)).toBe('b.md:2');
    expect(conflictViolation(['a.md'], (f) => files[f] ?? null)).toBeNull();
  });

  const hook = resolve(__dirname, 'precommit.mjs');
  const vcs = (cwd: string, ...a: string[]) =>
    spawnSync('git', a, { cwd, encoding: 'utf8', env: specEnv({}) });
  const runHook = (cwd: string) =>
    spawnSync('node', [hook], { cwd, encoding: 'utf8', env: specEnv({ UEB_PRECOMMIT_SKIP_LINT: '1' }) });
  const stage = (name: string, content: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'precommit-cm-'));
    try {
      vcs(dir, 'init', '-q');
      writeFileSync(join(dir, name), content);
      vcs(dir, 'add', name);
      return runHook(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  it('the hook refuses a staged file with markers and accepts a setext heading', () => {
    const bad = stage('notes.md', marked + '\n');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('notes.md:2');
    expect(stage('notes.md', `Title\n${L('=', 7)}\n\ntext\n`).status).toBe(0);
  });
  it('checks the staged content, not the working copy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'precommit-cm-'));
    try {
      vcs(dir, 'init', '-q');
      writeFileSync(join(dir, 'a.md'), 'fine\n');
      vcs(dir, 'add', 'a.md');
      writeFileSync(join(dir, 'a.md'), marked); // unstaged edit
      expect(runHook(dir).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
