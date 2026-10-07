import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../testing/plant.mjs';

// Every e2e spec creates its own projects. Two files that create the same key share server state: whichever runs second
// finds "already exists", skips its own setup and fails (activity-stage.spec reused builder-stage.spec's `stagestadt`,
// 2026-10-03, WP-737). Keys given as a literal or as a `const NAME = '<key>'` in the same file are checked, wherever the
// call sits: in a test, in a `test.extend({ world: [fn, { scope: 'worker' }] })` fixture body (WP-1017), or in a helper
// whose name ends in `createProject` (called with the key, or with `{ key }`). Keys built at runtime (loops, template
// strings with `${}`, imported constants) are out of scope.
// Admin e-mails follow the same rule: all specs of a shard share one data directory and `create-admin` refuses an
// existing e-mail, so two files creating the same literal account fail whenever the shard dealer puts them together
// (data-edit-mode and builder-canvas-edit both used `editdeploy@example.org`, e2e:main 520405c, 2026-10-05). E-mails
// from `uniqueEmail(...)` or other runtime values are out of scope.
const root = fileURLToPath(new URL('../..', import.meta.url));
const e2e = join(root, 'apps/web/e2e');

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (isPlanted(p) || e.name === 'node_modules' || e.name.startsWith('.')) return [];
    return e.isDirectory() ? walk(p) : e.name.endsWith('.ts') ? [p] : [];
  });

const LITERAL = /^['"`]([a-z0-9_-]+)['"`]$/;

/** Project keys a file creates: `admin(['create-project', <key>, …])` or `<helper>createProject(<key> | { key: <key> })`. */
function createdKeys(text: string): string[] {
  const consts = new Map(
    [...text.matchAll(/const\s+([A-Za-z_]\w*)\s*=\s*['"`]([a-z0-9_-]+)['"`]/g)].map(
      (m) => [m[1], m[2]] as const,
    ),
  );
  const keys = new Set<string>();
  const add = (arg: string): void => {
    const key = LITERAL.exec(arg)?.[1] ?? consts.get(arg);
    if (key) keys.add(key);
  };
  for (const m of text.matchAll(/['"`]create-project['"`],\s*([^,\]]+)/g)) add((m[1] ?? '').trim());
  for (const m of text.matchAll(/\w*[cC]reateProject\(\s*(?:\{\s*key:\s*)?([^,)}]+)/g))
    add((m[1] ?? '').trim());
  return [...keys];
}

const EMAIL = /^['"`]([^'"`$\s]+@[^'"`$\s]+)['"`]$/;

/** Admin e-mails a file creates: `admin(['create-admin', <e-mail>, …])` or `createAdmin(<e-mail>, …)`. */
function createdEmails(text: string): string[] {
  const consts = new Map(
    [...text.matchAll(/const\s+([A-Za-z_]\w*)\s*=\s*['"`]([^'"`$\s]+@[^'"`$\s]+)['"`]/g)].map(
      (m) => [m[1], m[2]] as const,
    ),
  );
  const emails = new Set<string>();
  const add = (arg: string): void => {
    const email = EMAIL.exec(arg)?.[1] ?? consts.get(arg);
    if (email) emails.add(email);
  };
  for (const m of text.matchAll(/['"`]create-admin['"`],\s*([^,\]]+)/g)) add((m[1] ?? '').trim());
  for (const m of text.matchAll(/\bcreateAdmin\(\s*([^,)]+)/g)) add((m[1] ?? '').trim());
  return [...emails];
}

/** Keys created by more than one file, as `key: file, file`. */
function sharedKeys(files: Map<string, string[]>): string[] {
  const owners = new Map<string, string[]>();
  for (const [file, keys] of files)
    for (const key of keys) owners.set(key, [...(owners.get(key) ?? []), file]);
  return [...owners].filter(([, f]) => f.length > 1).map(([k, f]) => `${k}: ${f.join(', ')}`);
}

describe('e2e project keys and admin e-mails (WP-737 follow-up)', () => {
  it('reads literal and const keys, skips runtime ones', () => {
    const text = [
      "const KEY = 'alpha';",
      "admin(['create-project', KEY, 'A']);",
      "admin(['create-project', 'beta', 'B']);",
      "admin(['create-project', p.key, 'C']);",
      'admin([`create-project`, `x${n}`]);',
    ].join('\n');
    expect(createdKeys(text).sort()).toEqual(['alpha', 'beta']);
  });

  it('finds keys inside fixture bodies and helper calls', () => {
    const text = [
      "const KEY = 'gamma';",
      'const test = base.extend<{}, { world: string }>({',
      '  world: [',
      '    async ({}, use) => {',
      "      admin(['create-project', KEY, KEY]);",
      "      createProject('delta');",
      "      await adminCreateProject({ key: 'epsilon', name: 'E' });",
      '      createProject(`zeta`);',
      '      createProject(runtimeKey);',
      '      await use(KEY);',
      '    },',
      "    { scope: 'worker' },",
      '  ],',
      '});',
    ].join('\n');
    expect(createdKeys(text).sort()).toEqual(['delta', 'epsilon', 'gamma', 'zeta']);
  });

  it('a fixture key and an admin([...]) key of the same name are reported as shared', () => {
    const fixture = [
      'export const test = base.extend({',
      "  w: [async ({}, use) => { admin(['create-project', 'same', 'S']); await use(1); }, { scope: 'worker' }],",
      '});',
    ].join('\n');
    const plain = "admin(['create-project', 'same', 'S']);";
    const files = new Map([
      ['a.ts', createdKeys(fixture)],
      ['b.ts', createdKeys(plain)],
    ]);
    expect(sharedKeys(files)).toEqual(['same: a.ts, b.ts']);
  });

  it('reads literal and const admin e-mails, skips runtime ones', () => {
    const text = [
      "const DEPLOYER = 'editdeploy@example.org';",
      'createAdmin(DEPLOYER);',
      "createAdmin('other@example.org', 'pw');",
      "admin(['create-admin', 'cli@example.org']);",
      "createAdmin(uniqueEmail('x'));",
      'createAdmin(`run-${n}@example.org`);',
      'export function createAdmin(email: string): void {}',
    ].join('\n');
    expect(createdEmails(text).sort()).toEqual([
      'cli@example.org',
      'editdeploy@example.org',
      'other@example.org',
    ]);
  });

  it('the same literal admin e-mail in two files is reported as shared', () => {
    const files = new Map([
      ['a.spec.ts', createdEmails("const D = 'editdeploy@example.org';\ncreateAdmin(D);")],
      ['b.spec.ts', createdEmails("createAdmin('editdeploy@example.org');")],
    ]);
    expect(sharedKeys(files)).toEqual(['editdeploy@example.org: a.spec.ts, b.spec.ts']);
  });

  it('no admin e-mail is created by two e2e files', () => {
    const files = new Map(walk(e2e).map((f) => [relative(root, f), createdEmails(readFileSync(f, 'utf8'))]));
    expect(sharedKeys(files)).toEqual([]);
  });

  it('no project key is created by two e2e files', () => {
    const files = new Map(walk(e2e).map((f) => [relative(root, f), createdKeys(readFileSync(f, 'utf8'))]));
    expect(sharedKeys(files)).toEqual([]);
  });
});
