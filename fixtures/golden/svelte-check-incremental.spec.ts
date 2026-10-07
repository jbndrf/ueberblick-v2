import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// WP-912: svelte-check runs incrementally; its cache (.svelte-check/) is ignored by the VCS, ESLint and Prettier.
const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const packages = ['packages/ui', 'packages/builder'];
const cacheDir = '.svelte-check';

describe('svelte-check is incremental (WP-912)', () => {
  it.each(packages)('%s typecheck uses --incremental', (pkg) => {
    const scripts = (JSON.parse(read(`${pkg}/package.json`)) as { scripts: Record<string, string> }).scripts;
    expect(scripts['typecheck:nogen']).toMatch(/svelte-check\s[^&|]*--incremental/);
  });

  it('the VCS ignore file lists the cache', () => {
    expect(read('.gitignore').split('\n')).toContain(`${cacheDir}/`);
  });

  it('Prettier ignores the cache', () => {
    expect(read('.prettierignore')).toContain(`**/${cacheDir}/`);
  });

  it('ESLint ignores the cache', () => {
    expect(read('eslint.config.js')).toContain(`'**/${cacheDir}/**'`);
  });
});

describe('an incremental svelte-check still fails on a planted type error (WP-912)', () => {
  it('passes cold, then fails warm after the plant', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'svelte-check-'));
    try {
      mkdirSync(join(tmp, 'src'));
      writeFileSync(
        join(tmp, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'esnext', verbatimModuleSyntax: true },
          include: ['src/**/*'],
        }),
      );
      const file = join(tmp, 'src', 'A.svelte');
      const run = () =>
        spawnSync(
          join(root, 'node_modules/.bin/svelte-check'),
          ['--incremental', '--workspace', tmp, '--tsconfig', './tsconfig.json', '--threshold', 'warning'],
          { cwd: root, encoding: 'utf8' },
        );
      writeFileSync(file, '<script lang="ts">let n: number = 1;</script>{n}\n');
      const cold = run();
      expect(cold.status, cold.stdout + cold.stderr).toBe(0);
      writeFileSync(file, '<script lang="ts">let n: number = "x";</script>{n}\n');
      const warm = run();
      expect(warm.status).not.toBe(0);
      expect(`${warm.stdout}${warm.stderr}`).toMatch(/A\.svelte/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});
