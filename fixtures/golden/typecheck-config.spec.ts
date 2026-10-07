import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// WP-908: fixtures are typechecked, and every tsc project is incremental with a per-worktree build-info file.
const root = fileURLToPath(new URL('../..', import.meta.url));
const configs = [
  'tsconfig.json',
  'bench/tsconfig.json',
  'packages/ui/tsconfig.json',
  'packages/builder/tsconfig.json',
  'apps/web/tsconfig.json',
];

type RootConfig = { include: string[]; exclude: string[]; compilerOptions: Record<string, unknown> };

function rootConfig(): RootConfig {
  return JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')) as RootConfig;
}

// A temp dir with one sample file per area; the live tree is never listed.
function sandbox(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'fixtures-cfg-'));
  for (const f of ['fixtures/golden/sample.spec.ts', 'fixtures/golden/simulation/backend.ts', 'packages/core/a.ts']) {
    mkdirSync(join(tmp, f, '..'), { recursive: true });
    writeFileSync(join(tmp, f), 'export {};\n');
  }
  return tmp;
}

function listedFiles(base: string, cfg: RootConfig): string[] {
  const parsed = ts.parseJsonConfigFileContent(cfg, ts.sys, base);
  return parsed.fileNames;
}

describe('typecheck covers fixtures (WP-908)', () => {
  it('the root typecheck project lists fixtures/**/*.ts (config read, live tree untouched)', () => {
    const tmp = sandbox();
    try {
      const files = listedFiles(tmp, rootConfig());
      expect(files).toContain(join(tmp, 'fixtures/golden/sample.spec.ts'));
      expect(files).toContain(join(tmp, 'fixtures/golden/simulation/backend.ts'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('drops the fixtures when fixtures/**/*.ts leaves the root include', () => {
    const tmp = sandbox();
    try {
      const cfg = rootConfig();
      cfg.include = cfg.include.filter((g) => g !== 'fixtures/**/*.ts');
      const files = listedFiles(tmp, cfg);
      expect(files).toContain(join(tmp, 'packages/core/a.ts'));
      expect(files.some((f) => f.includes('/fixtures/'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails on a type error planted in a fixture file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fixtures-tsc-'));
    try {
      const planted = join(tmp, 'planted.typeerror.ts');
      writeFileSync(planted, 'export const n: number = "not a number";\n');
      const cfg = join(tmp, 'tsconfig.json');
      writeFileSync(
        cfg,
        JSON.stringify({
          extends: join(root, 'tsconfig.json'),
          compilerOptions: { noEmit: true, incremental: false, tsBuildInfoFile: null },
          include: [planted],
          exclude: [],
        }),
      );
      const r = spawnSync('npx', ['tsc', '-p', cfg], { cwd: root, encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(`${r.stdout}${r.stderr}`).toMatch(/planted\.typeerror\.ts.*TS2322/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('every tsc project is incremental (WP-908)', () => {
  it.each(configs)('%s sets incremental and a build-info file under node_modules/.cache/tsc', (file) => {
    const text = readFileSync(join(root, file), 'utf8');
    const opts = (JSON.parse(text) as { compilerOptions: Record<string, unknown> }).compilerOptions;
    expect(opts['incremental']).toBe(true);
    expect(String(opts['tsBuildInfoFile'])).toMatch(/^(\.\.?\/)+node_modules\/\.cache\/tsc\/[\w-]+\.tsbuildinfo$|^\.\/node_modules\/\.cache\/tsc\/[\w-]+\.tsbuildinfo$/);
  });

  it('the build-info files are distinct', () => {
    const paths = configs.map((f) => {
      const o = (JSON.parse(readFileSync(join(root, f), 'utf8')) as { compilerOptions: Record<string, string> })
        .compilerOptions;
      return o['tsBuildInfoFile'];
    });
    expect(new Set(paths).size).toBe(configs.length);
  });
});
