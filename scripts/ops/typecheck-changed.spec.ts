import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectTypecheck } from './typecheck-changed.mjs';

const cwd = process.cwd();
const pick = (...files: string[]) => selectTypecheck(cwd, files);

describe('typecheck selection (WP-1012)', () => {
  it('an apps/web file typechecks web only', () => {
    const s = pick('apps/web/src/routes/+page.svelte');
    expect(s.all).toBe(false);
    expect(s.projects).toEqual(['web']);
    expect(s.line).toBe('typecheck: web (apps/web changed)');
  });

  it('a packages/core file typechecks every dependant', () => {
    const s = pick('packages/core/src/plan/plan.ts');
    expect(s.all).toBe(false);
    expect(s.projects).toEqual(['root', 'ui', 'builder', 'bench', 'web']);
  });

  it('a scripts file typechecks root only', () => {
    const s = pick('scripts/ops/steps.ts');
    expect(s.projects).toEqual(['root']);
    expect(s.line).toBe('typecheck: root (scripts changed)');
  });

  it('packages/ui typechecks ui, builder (imports ui), web and bench', () => {
    const s = pick('packages/ui/src/lib/thing.svelte');
    expect(s.projects).toEqual(['ui', 'builder', 'bench', 'web']);
  });

  it('packages/builder typechecks builder, web and bench', () => {
    expect(pick('packages/builder/src/x.ts').projects).toEqual(['builder', 'bench', 'web']);
  });

  it('a tool imported by ui is found through the tsconfig include', () => {
    expect(pick('packages/tools/photo/src/index.ts').projects).toContain('ui');
  });

  it('config changes typecheck everything', () => {
    for (const f of [
      'tsconfig.json',
      'packages/ui/tsconfig.json',
      'package.json',
      'apps/web/package.json',
      'package-lock.json',
      'apps/web/svelte.config.js',
      'globals.d.ts',
    ]) {
      const s = pick(f);
      expect(s.all, f).toBe(true);
      expect(s.line, f).toMatch(/^typecheck: all \(/);
    }
  });

  it('an unknown code path falls back to all', () => {
    expect(pick('weird/dir/thing.ts').all).toBe(true);
    expect(pick('packages/ui/loose.ts').all).toBe(true);
  });

  it('a deleted code file counts like a changed one', () => {
    expect(selectTypecheck(cwd, [], ['apps/web/src/lib/gone.ts']).projects).toEqual(['web']);
  });

  it('files that no typecheck reads select nothing', () => {
    const s = pick('docs/process/orchestration.md', 'work/WP-1.md', 'scripts/ops/x.mjs');
    expect(s.all).toBe(false);
    expect(s.projects).toEqual([]);
    expect(s.line).toBe('typecheck: none (no typechecked file changed)');
  });

  it('a union of changes unions the projects, in project order', () => {
    expect(pick('apps/web/src/a.ts', 'scripts/ops/b.ts').projects).toEqual(['root', 'web']);
  });
});

describe('wiring', () => {
  const s = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
  it('check:fast:scoped uses the scoped typecheck; the full typecheck stays', () => {
    expect(s['check:fast:scoped']).toMatch(
      /^node scripts\/ops\/steps\.mjs --parallel --fail-fast --before typecheck:gen fast typecheck:changed lint:changed /,
    );
    expect(s['typecheck:changed']).toBe('node scripts/ops/typecheck-changed.mjs main');
    expect(s['check:fast:run']).toMatch(
      /steps\.mjs --parallel --fail-fast --before typecheck:gen fast typecheck lint /,
    );
  });
});

describe('apps/web tsconfig exclude (WP-1022)', () => {
  // apps/web's own `exclude` replaces the one of the extended, generated .svelte-kit/tsconfig.json, so it must
  // keep every entry of it (paths there are relative to .svelte-kit/, here to apps/web/).
  const generated = 'apps/web/.svelte-kit/tsconfig.json';
  it.skipIf(!existsSync(generated))('keeps every exclude entry SvelteKit generates', () => {
    const read = (f: string): { exclude?: string[] } => JSON.parse(readFileSync(f, 'utf8'));
    const mine = read('apps/web/tsconfig.json').exclude ?? [];
    const theirs = (read(generated).exclude ?? []).map((e) => e.replace(/^\.\.\//, ''));
    expect(theirs.length).toBeGreaterThan(0);
    expect(mine).toEqual(expect.arrayContaining(theirs));
  });
});
