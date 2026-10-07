import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintPlan } from './lint-changed.mjs';
import { specEnv } from '../testing/spec-env.mjs';

// WP-997: check:changed lints only the branch's changed files; a lint config change or a missing merge-base lints all.
let repo: string;
const git = (...a: string[]) =>
  execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: specEnv() }).trim();
const put = (f: string, text = 'x\n') => {
  mkdirSync(join(repo, f, '..'), { recursive: true });
  writeFileSync(join(repo, f), text);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'lint-changed-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'n');
  for (const f of ['packages/a/src/old.ts', 'packages/a/src/gone.ts', 'eslint.config.js', 'package.json'])
    put(f, f === 'package.json' ? '{"name":"x"}\n' : 'x\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'wp/x');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('lintPlan', () => {
  it('hands exactly the changed and untracked files to eslint and prettier', () => {
    put('packages/a/src/old.ts', 'y\n');
    git('add', '.');
    git('commit', '-qm', 'edit');
    put('apps/web/src/new.svelte');
    put('docs/note.md');
    const p = lintPlan(repo, 'main');
    expect(p.scope).toBe('files');
    if (p.scope !== 'files') return;
    expect([...p.eslint].sort()).toEqual(['apps/web/src/new.svelte', 'packages/a/src/old.ts']);
    expect([...p.prettier].sort()).toEqual(['apps/web/src/new.svelte', 'packages/a/src/old.ts']);
    expect(p.line).toBe('lint: 2 changed files');
  });
  it('does not pass a deleted file', () => {
    unlinkSync(join(repo, 'packages/a/src/gone.ts'));
    put('packages/a/src/old.ts', 'z\n');
    const p = lintPlan(repo, 'main');
    if (p.scope !== 'files') throw new Error('expected files');
    expect(p.eslint).toEqual(['packages/a/src/old.ts']);
  });
  it.each(['eslint.config.js', '.prettierrc', '.prettierignore'])(
    'lints the whole repo when %s changed',
    (f) => {
      put(f, 'changed\n');
      expect(lintPlan(repo, 'main')).toEqual({ scope: 'all', line: `lint: ${f} changed -> whole repo` });
    },
  );
  it('lints the whole repo when package.json changes its prettier key', () => {
    put('package.json', '{"name":"x","prettier":{"semi":false}}\n');
    expect(lintPlan(repo, 'main')).toMatchObject({ scope: 'all' });
  });
  it('keeps the partial lint when package.json changes another key', () => {
    put('package.json', '{"name":"x","scripts":{"a":"b"}}\n');
    expect(lintPlan(repo, 'main').scope).toBe('files');
  });
  it('lints the whole repo when there is no merge-base', () => {
    expect(lintPlan(repo, 'no-such-ref')).toEqual({
      scope: 'all',
      line: 'lint: no merge-base with no-such-ref -> whole repo',
    });
  });
});

describe('wiring', () => {
  const s = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
  it('check:changed lints scoped; check:fast and check keep the full lint', () => {
    expect(s['check:changed']).toMatch(
      /steps\.mjs --parallel --fail-fast --before typecheck:gen changed check:fast:scoped boundaries test:changed$/,
    );
    expect(s['check:fast:scoped']).toContain('lint:changed');
    expect(s['check:fast:scoped']).not.toMatch(/ lint /);
    expect(s['check:fast:run']).toMatch(/typecheck lint glossary/);
    expect(s['check']).toContain('check:fast');
  });
});
