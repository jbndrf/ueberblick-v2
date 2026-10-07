import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// WP-1003: the `@lucide/svelte` root barrel costs ~10 s cold per worker. Icons come in by deep import
// (`import X from '@lucide/svelte/icons/x'`); only type imports may use the root.
const ROOT = join(import.meta.dirname, '..', '..');
const ROOT_IMPORT = /import\s+(type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]@lucide\/svelte['"]/g;

/** Tracked and untracked-but-not-ignored source files under `dirs`: git-ignored output (`.svelte-check`,
 *  `.svelte-kit`, builds, `node_modules`) is never walked, so a stale generated file cannot turn the guard red. */
export function sourceFiles(root: string, dirs: string[]): string[] {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...dirs],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter((f) => /\.(svelte|ts)$/.test(f))
    .map((f) => join(root, f))
    .filter((f) => existsSync(f));
}

/** True when the file value-imports from the root barrel (a `type` import costs nothing). */
export function hasRootValueImport(src: string): boolean {
  for (const m of src.matchAll(ROOT_IMPORT)) {
    if (m[1]) continue;
    const names = (m[2] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.some((n) => !n.startsWith('type '))) return true;
  }
  return false;
}

describe('lucide deep imports (WP-1003)', () => {
  it('the detector sees value imports and ignores type imports', () => {
    expect(hasRootValueImport(`import { X } from '@lucide/svelte';`)).toBe(true);
    expect(hasRootValueImport(`import {\n  A,\n  B,\n} from '@lucide/svelte';`)).toBe(true);
    expect(hasRootValueImport(`import { type IconProps, X } from '@lucide/svelte';`)).toBe(true);
    expect(hasRootValueImport(`import type { IconProps } from '@lucide/svelte';`)).toBe(false);
    expect(hasRootValueImport(`import { type IconProps } from '@lucide/svelte';`)).toBe(false);
    expect(hasRootValueImport(`import X from '@lucide/svelte/icons/x';`)).toBe(false);
  });

  it('walks tracked and untracked sources but never git-ignored output like .svelte-check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lucide-walk-'));
    try {
      const put = (f: string, src = `import { X } from '@lucide/svelte';`) => {
        mkdirSync(join(dir, f, '..'), { recursive: true });
        writeFileSync(join(dir, f), src);
      };
      execFileSync('git', ['init', '-q'], { cwd: dir });
      put('.gitignore', '.svelte-check/\n');
      put('packages/ui/a.ts');
      execFileSync('git', ['add', '.'], { cwd: dir });
      put('packages/ui/new.svelte');
      put('packages/ui/.svelte-check/svelte/src/++A.svelte.ts');
      const found = sourceFiles(dir, ['packages', 'apps']).map((f) => f.slice(dir.length + 1));
      expect(found.sort()).toEqual(['packages/ui/a.ts', 'packages/ui/new.svelte']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no file in packages/ or apps/ value-imports from the @lucide/svelte root', () => {
    const files = sourceFiles(ROOT, ['packages', 'apps']);
    const bad = files
      .filter((f) => !f.endsWith('lucide-imports.spec.ts'))
      .filter((f) => hasRootValueImport(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));
    expect(bad, `use '@lucide/svelte/icons/<kebab-name>' (WP-1003):\n${bad.join('\n')}`).toEqual([]);
  });
});
