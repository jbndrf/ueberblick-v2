import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { selectChanged } from './changed-select.mjs';

// WP-1010: a non-spec helper that reads a narrowed tree seeds the import graph.
describe('reader modules of a narrowed tree (WP-1010)', () => {
  let repo: string;
  const env = specEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });
  const put = (file: string, text: string) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  };
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'changed-select-mod-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env });
    put('fixtures/golden/x.yaml', 'a: 1');
    put(
      'packages/core/src/testing/golden.ts',
      "export const files = import.meta.glob('/fixtures/golden/**/*.yaml');",
    );
    put('packages/core/src/testing/plain.ts', 'export const plain = 1;');
    put('packages/core/src/testing/golden.planted.ts', "const x = '/fixtures/golden/';");
    put('packages/server/src/store.spec.ts', "import { files } from '../../core/src/testing/golden';");
    put('packages/server/src/reader.spec.ts', "readFileSync('fixtures/golden/x.yaml')");
    execFileSync('git', ['add', '-A'], { cwd: repo, env });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('a helper whose text reads the tree is a seed, and the line names it', () => {
    const r = selectChanged(repo, ['fixtures/golden/x.yaml']);
    expect(r.all).toBe(false);
    expect(r.related).toContain('packages/core/src/testing/golden.ts');
    expect(r.lines).toEqual([
      'fixtures/golden: 1 files -> 1 reader specs + 1 reader modules (packages/core/src/testing/golden.ts) + import graph',
    ]);
  });

  it('a helper whose text does not match, and a planted file, are not seeded', () => {
    const r = selectChanged(repo, ['fixtures/golden/x.yaml']);
    expect(r.related).not.toContain('packages/core/src/testing/plain.ts');
    expect(r.related).not.toContain('packages/core/src/testing/golden.planted.ts');
  });

  it('a helper alone is a reader: noReader "all" does not fire', () => {
    rmSync(join(repo, 'packages/server/src/reader.spec.ts'));
    const r = selectChanged(repo, ['fixtures/golden/x.yaml']);
    expect(r.all).toBe(false);
    expect(r.related).toContain('packages/core/src/testing/golden.ts');
  });

  it('a module that only names the tree in a comment is not seeded', () => {
    put(
      'packages/core/src/testing/doc.ts',
      "// see fixtures/golden/x.yaml\n/* join('fixtures/golden') */\nexport const d = 1;",
    );
    expect(selectChanged(repo, ['fixtures/golden/x.yaml']).related).not.toContain(
      'packages/core/src/testing/doc.ts',
    );
  });

  it('only golden and schema scan modules: messages, docs/process and scripts do not', () => {
    put('apps/web/messages/de.json', '{}');
    put('apps/web/project.inlang/settings.json', '{}');
    put('apps/web/src/c.ts', "import { m } from '../messages';\n// docs/process/x.md");
    put('apps/web/src/m.spec.ts', "readFileSync('apps/web/messages/de.json')");
    const r = selectChanged(repo, ['apps/web/messages/de.json']);
    expect(r.related).not.toContain('apps/web/src/c.ts');
    expect(r.lines[0]).not.toContain('reader modules');
    expect(selectChanged(repo, ['docs/process/x.md']).related).not.toContain('apps/web/src/c.ts');
  });
});
