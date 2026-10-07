import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { ALWAYS_SPECS, selectChanged } from './changed-select.mjs';

// WP-955 contracts 2-4: what check:changed selects per changed file, and why (the printed lines).
const root = process.cwd();
const sel = (...files: string[]) => selectChanged(root, files);
// The selector skips a listed spec the checkout lacks (the public export has no fleet specs).
const always = ALWAYS_SPECS.filter((f) => existsSync(join(root, f)));

describe('check:changed selection', () => {
  it("a messages-only change selects the package's compiled entry and every by-path reader", () => {
    const r = sel('packages/ui/messages/de.json');
    expect(r.all).toBe(false);
    expect(r.related).toContain('packages/ui/src/paraglide/messages.js');
    expect(r.related).toContain('packages/ui/src/i18n.spec.ts');
    expect(r.related).not.toContain('apps/web/src/lib/participant/paraglide/messages.js');
    expect(r.lines[0]).toMatch(/^messages: 1 files -> \d+ reader specs/);
  });

  it('project.inlang selects like messages; an unknown catalogue stays a trigger', () => {
    expect(sel('apps/web/project.inlang/settings.json').related).toContain(
      'apps/web/src/lib/participant/catalogues.spec.ts',
    );
    expect(sel('packages/new/messages/de.json').all).toBe(true);
  });

  it("a tool package's catalogue selects that tool's compiled entry (WP-989)", () => {
    const r = sel('packages/tools/photo/messages/de.json');
    expect(r.all).toBe(false);
    expect(r.related).toContain('packages/tools/photo/src/paraglide/messages.js');
    expect(r.related).not.toContain('packages/ui/src/paraglide/messages.js');
    expect(r.messagePackages).toEqual(['packages/tools/photo']);
  });

  it('a blanket trigger runs everything and says which file', () => {
    const r = sel('packages/ui/src/a.ts', 'package-lock.json');
    expect(r).toMatchObject({ all: true, lines: ['trigger package-lock.json -> all tests'] });
  });

  it('a scripts file selects its graph, the specs naming it and the tree scanners, not everything', () => {
    const r = sel('scripts/ops/housekeep.mjs');
    expect(r.all).toBe(false);
    expect(r.related).toContain('scripts/ops/housekeep.spec.ts');
    expect(r.related).toContain('scripts/ops/tmp-leak.spec.ts');
  });

  it('docs/process and agent files select their listed readers', () => {
    expect(sel('docs/process/v3-journeys.md').related).toContain('scripts/e2e/journeys.spec.ts');
    expect(sel('.claude/agents/implementer.md').related).toContain('scripts/ops/tmp-leak.spec.ts');
    expect(sel('CLAUDE.md').all).toBe(false);
  });

  it('an ordinary source file selects itself and the always list (vitest adds its importers)', () => {
    const r = sel('packages/core/src/geo/bbox.ts');
    expect(r.all).toBe(false);
    expect(r.related).toEqual(['packages/core/src/geo/bbox.ts', ...always]);
  });

  it('WP-1039: an unrelated change, or none, still selects every whole-tree guard spec', () => {
    for (const r of [sel('docs/user/index.md'), sel()]) {
      expect(r.all).toBe(false);
      for (const g of always) expect(r.related).toContain(g);
    }
    expect(ALWAYS_SPECS).toEqual(
      expect.arrayContaining([
        'scripts/testing/plant.spec.ts',
        'scripts/testing/spec-env.spec.ts',
        'scripts/guardrails.spec.ts',
        'scripts/ops/e2e-project-keys.spec.ts',
        'scripts/metrics/parity.spec.ts',
        'scripts/ops/wp-ids.spec.ts',
      ]),
    );
  });

  it('the always list is skipped for a spec absent from the repository (a fixture repo)', () => {
    expect(selectChanged(tmpdir(), ['a.ts']).related).toEqual(['a.ts']);
  });

  it('a deleted non-spec file without a merge-base runs everything; a deleted spec does not', () => {
    expect(selectChanged(root, [], ['packages/core/src/x.ts'])).toMatchObject({
      all: true,
      lines: [expect.stringMatching(/^deleted packages\/core\/src\/x\.ts -> all tests/)],
    });
    expect(selectChanged(root, [], ['packages/core/src/x.spec.ts']).all).toBe(false);
  });

  describe('readers are found by scanning, not listed', () => {
    let repo: string;
    const env = specEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' });
    const put = (file: string, text: string) => {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), text);
    };
    beforeEach(() => {
      repo = mkdtempSync(join(tmpdir(), 'changed-select-'));
      git('init', '-q', '-b', 'main');
      put('packages/x/src/reader.spec.ts', "readFileSync('apps/web/messages/de.json')");
      put('packages/x/src/other.spec.ts', 'expect(1).toBe(1)');
      put('apps/web/project.inlang/settings.json', '{}');
      git('add', '-A');
    });
    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    it('a spec reading messages/de.json is selected without being listed, and unrelated specs are not', () => {
      const r = selectChanged(repo, ['apps/web/messages/de.json']);
      expect(r.related).toContain('packages/x/src/reader.spec.ts');
      expect(r.related).not.toContain('packages/x/src/other.spec.ts');
      expect(r.lines).toEqual(['messages: 1 files -> 1 reader specs + import graph']);
    });

    it('a new tool package is picked up from the tree; a messages path outside any inlang package is a trigger', () => {
      put('packages/tools/zeta/project.inlang/settings.json', '{}');
      put('packages/tools/zeta/messages/de.json', '{}');
      put('packages/tools/orphan/messages/de.json', '{}');
      const r = selectChanged(repo, ['packages/tools/zeta/messages/de.json']);
      expect(r.all).toBe(false);
      expect(r.related).toContain('packages/tools/zeta/src/paraglide/messages.js');
      const o = selectChanged(repo, ['packages/tools/orphan/messages/de.json']);
      expect(o.all).toBe(true);
      expect(o.lines[0]).toContain('no compiled entry known');
    });

    it('a renamed reader is found under its new name; an untracked reader too', () => {
      git('mv', 'packages/x/src/reader.spec.ts', 'packages/x/src/renamed.spec.ts');
      put('packages/x/src/fresh.spec.ts', "join(root, 'docs/process/x.md')");
      expect(selectChanged(repo, ['apps/web/messages/en.json']).related).toContain(
        'packages/x/src/renamed.spec.ts',
      );
      expect(selectChanged(repo, ['docs/process/x.md']).related).toContain('packages/x/src/fresh.spec.ts');
    });

    it('a tracked spec removed on disk without staging is skipped, not read', () => {
      rmSync(join(repo, 'packages/x/src/other.spec.ts'));
      const r = selectChanged(
        repo,
        ['CLAUDE.md', 'apps/web/messages/de.json'],
        ['packages/x/src/other.spec.ts'],
      );
      expect(r.related).toContain('packages/x/src/reader.spec.ts');
      expect(r.related).not.toContain('packages/x/src/other.spec.ts');
    });
  });
  // WP-991: narrowed triggers and the delete rule, on a committed temp repo (the base is its first commit).
  describe('narrowed triggers (WP-991)', () => {
    let repo: string;
    let base: string;
    const env = specEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' }).trim();
    const put = (file: string, text: string) => {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), text);
    };
    const pkg = (o: object) => JSON.stringify({ name: '@x/web', scripts: { build: 'vite build' }, ...o });
    const S = 'packages/x/src/';
    beforeEach(() => {
      repo = mkdtempSync(join(tmpdir(), 'changed-narrow-'));
      git('init', '-q', '-b', 'main');
      put(`${S}budget.spec.ts`, "readFileSync('docs/12-performance-budgets.md')");
      put(`${S}cruise.spec.ts`, "readFileSync('.dependency-cruiser.cjs')");
      put(`${S}lintrule.spec.ts`, "run('npx eslint --no-ignore x.ts')");
      put(`${S}pkgreader.spec.ts`, "readFileSync('apps/web/package.json')");
      put(`${S}script.spec.ts`, "execSync('npm run bundle')");
      put(`${S}golden.spec.ts`, "readFileSync('fixtures/golden/templates/t.yaml')");
      put(`${S}importer.spec.ts`, "import { a } from './a';\nvoid a;");
      put(`${S}a.ts`, 'export const a = 1;');
      put(`${S}other.spec.ts`, 'expect(1).toBe(1)');
      put('apps/web/package.json', pkg({ dependencies: { x: '1' } }));
      put('fixtures/golden/templates/t.yaml', 'a: 1');
      put('fixtures/golden/templates/u.yaml', 'a: 2');
      git('add', '-A');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
      base = git('rev-parse', 'HEAD');
    });
    afterEach(() => rmSync(repo, { recursive: true, force: true }));
    const opts = () => ({ base });

    it('the budgets doc selects its reader specs only', () => {
      const r = selectChanged(repo, ['docs/12-performance-budgets.md'], [], opts());
      expect(r.all).toBe(false);
      expect(r.related).toContain(`${S}budget.spec.ts`);
      expect(r.related).not.toContain(`${S}other.spec.ts`);
    });

    it('.dependency-cruiser.cjs selects its readers and says boundaries checks it', () => {
      const r = selectChanged(repo, ['.dependency-cruiser.cjs'], [], opts());
      expect(r.all).toBe(false);
      expect(r.related).toContain(`${S}cruise.spec.ts`);
      expect(r.lines.join('\n')).toMatch(/boundaries/);
    });

    it('a lint config selects the specs that run eslint or prettier, not every test', () => {
      for (const f of ['eslint.config.js', '.prettierrc', '.prettierignore']) {
        const r = selectChanged(repo, [f], [], opts());
        expect(r.all).toBe(false);
        expect(r.related).toContain(`${S}lintrule.spec.ts`);
        expect(r.related).not.toContain(`${S}other.spec.ts`);
        expect(r.lines.join('\n')).toMatch(/lint:changed checks the whole repo/);
      }
    });

    it('a package.json change of scripts only selects the readers and the specs naming a changed script', () => {
      put(
        'apps/web/package.json',
        pkg({ dependencies: { x: '1' }, scripts: { build: 'vite build', bundle: 'x' } }),
      );
      const r = selectChanged(repo, ['apps/web/package.json'], [], opts());
      expect(r.all).toBe(false);
      expect(r.related).toContain(`${S}pkgreader.spec.ts`);
      expect(r.related).toContain(`${S}script.spec.ts`);
      expect(r.related).not.toContain(`${S}other.spec.ts`);
      expect(r.lines.join('\n')).toMatch(/package\.json: scripts only -> \d+ reader specs/);
    });

    it('a package.json dependency change runs everything', () => {
      put('apps/web/package.json', pkg({ dependencies: { x: '2' } }));
      const r = selectChanged(repo, ['apps/web/package.json'], [], opts());
      expect(r.all).toBe(true);
      expect(r.lines[0]).toMatch(/package\.json/);
    });

    it('a new or unreadable package.json, or no merge-base, runs everything', () => {
      put('packages/new/package.json', pkg({}));
      expect(selectChanged(repo, ['packages/new/package.json'], [], opts()).all).toBe(true);
      put('apps/web/package.json', '{ not json');
      expect(selectChanged(repo, ['apps/web/package.json'], [], opts()).all).toBe(true);
      put('apps/web/package.json', pkg({ dependencies: { x: '1' }, description: 'd' }));
      expect(selectChanged(repo, ['apps/web/package.json'], []).all).toBe(true);
    });

    it('a golden file selects the specs that read it; with no reader it runs everything', () => {
      const hit = selectChanged(repo, ['fixtures/golden/templates/t.yaml'], [], opts());
      expect(hit.all).toBe(false);
      expect(hit.related).toContain(`${S}golden.spec.ts`);
      expect(hit.related).not.toContain(`${S}other.spec.ts`);
      const miss = selectChanged(repo, ['schema/none.json'], [], opts());
      expect(miss.all).toBe(true);
      expect(miss.lines[0]).toMatch(/schema\/none\.json.*no reader spec/);
    });

    it('a deleted file selects the specs that imported it at the merge-base', () => {
      git('rm', '-q', `${S}a.ts`);
      const r = selectChanged(repo, [], [`${S}a.ts`], opts());
      expect(r.all).toBe(false);
      expect(r.related).toContain(`${S}importer.spec.ts`);
      expect(r.related).not.toContain(`${S}other.spec.ts`);
      expect(r.lines.join('\n')).toMatch(/deleted packages\/x\/src\/a\.ts -> 1 specs that imported it/);
    });

    it('a deleted file runs everything when the graph at the merge-base cannot be built', () => {
      const r = selectChanged(repo, [], [`${S}a.ts`], { base: 'deadbeef' });
      expect(r.all).toBe(true);
      expect(r.lines[0]).toMatch(/deleted packages\/x\/src\/a\.ts -> all tests/);
    });

    it('a deleted blanket trigger still runs everything', () => {
      expect(selectChanged(repo, [], ['vitest.config.ts'], opts()).all).toBe(true);
    });
  });

  // WP-992: a barrel edit that only adds re-exports of new modules selects no importers of the barrel.
  describe('additive barrel edits (WP-992)', () => {
    let repo: string;
    let base: string;
    const env = specEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' }).trim();
    const put = (file: string, text: string) => {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), text);
    };
    const R = 'packages/x/src/registry/';
    const BARREL = `${R}index.ts`;
    const OLD = "export { A } from './a';\nexport { B } from './b';\n";
    beforeEach(() => {
      repo = mkdtempSync(join(tmpdir(), 'changed-barrel-'));
      git('init', '-q', '-b', 'main');
      put(BARREL, OLD);
      put(`${R}a.ts`, 'export const A = 1;');
      put(`${R}b.ts`, 'export const B = 1;');
      put(`${R}c.ts`, 'export const C = 1;');
      put('packages/x/src/user.spec.ts', "import { A } from './registry';\nvoid A;");
      git('add', '-A');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
      base = git('rev-parse', 'HEAD');
    });
    afterEach(() => rmSync(repo, { recursive: true, force: true }));
    const opts = () => ({ base });

    it('an added line for a new module selects no importers; the new module and its spec stay in the diff', () => {
      put(BARREL, `${OLD}export { D } from './d';\n`);
      put(`${R}d.ts`, 'export const D = 1;');
      put(`${R}d.spec.ts`, "import { D } from './d';\nvoid D;");
      const r = selectChanged(repo, [BARREL, `${R}d.ts`, `${R}d.spec.ts`], [], opts());
      expect(r.all).toBe(false);
      expect(r.related).not.toContain(BARREL);
      expect(r.related).not.toContain(`${R}d.ts`); // vitest would reach the barrel's importers through it
      expect(r.related).toContain(`${R}d.spec.ts`);
      expect(r.lines).toContain(
        `check:changed barrel ${BARREL}: 1 added exports -> no importers (their users are in the diff)`,
      );
    });

    it('works on the committed head of a recorded run too', () => {
      put(BARREL, `${OLD}export { D } from './d';\n`);
      put(`${R}d.ts`, 'export const D = 1;');
      git('add', '-A');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'add d');
      rmSync(join(repo, BARREL));
      const r = selectChanged(repo, [BARREL], [], { base, head: git('rev-parse', 'HEAD') });
      expect(r.related).not.toContain(BARREL);
    });

    it('a removed or re-pointed export selects the barrel as today', () => {
      put(BARREL, "export { A } from './a';\n");
      expect(selectChanged(repo, [BARREL], [], opts()).related).toEqual([BARREL]);
      put(BARREL, "export { A } from './a';\nexport { B } from './c';\n");
      expect(selectChanged(repo, [BARREL], [], opts()).related).toEqual([BARREL]);
    });

    it('an added `export *`, a non-barrel statement, or an added line for an existing module selects the barrel', () => {
      put(BARREL, `${OLD}export * from './c';\n`);
      expect(selectChanged(repo, [BARREL], [], opts()).related).toEqual([BARREL]);
      put(BARREL, `${OLD}export const X = 1;\n`);
      expect(selectChanged(repo, [BARREL], [], opts()).related).toEqual([BARREL]);
      put(BARREL, `${OLD}export { C } from './c';\n`); // c.ts existed: the barrel's importers now load it
      expect(selectChanged(repo, [BARREL], [], opts()).related).toEqual([BARREL]);
    });

    it('a new barrel file, or one with no base, selects as today', () => {
      put(`${R}new/index.ts`, "export { N } from './n';\n");
      expect(selectChanged(repo, [`${R}new/index.ts`], [], opts()).related).toEqual([`${R}new/index.ts`]);
      put(BARREL, `${OLD}export { D } from './d';\n`);
      put(`${R}d.ts`, 'export const D = 1;');
      expect(selectChanged(repo, [BARREL], []).related).toEqual([BARREL]);
    });

    // WP-996: a local named export wins over the same name from an `export *`
    describe('an added name against export * of the barrel', () => {
      const STAR = "export { A } from './a';\nexport * from './s';\n";
      const commitStar = (starText: string, barrel = STAR) => {
        put(BARREL, barrel);
        put(`${R}s.ts`, starText);
        git('add', '-A');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'star');
        return git('rev-parse', 'HEAD');
      };
      const addNew = (name: string, barrel = STAR) => {
        put(BARREL, `${barrel}export { ${name} } from './new';\n`);
        put(`${R}new.ts`, `export const ${name} = 1;`);
      };
      const changed = [BARREL, `${R}new.ts`];

      it('a name the star target exports is not additive and says why', () => {
        const b = commitStar('export const foo = 1;');
        addNew('foo');
        const r = selectChanged(repo, changed, [], { base: b });
        expect(r.related).toContain(BARREL);
        expect(r.lines).toContain(
          `check:changed barrel ${BARREL}: added 'foo' shadows export * from './s' -> importers`,
        );
      });

      it('a name the star target does not export stays additive', () => {
        const b = commitStar('export const foo = 1;');
        addNew('bar');
        expect(selectChanged(repo, changed, [], { base: b }).related).not.toContain(BARREL);
      });

      it('sees names behind one nested star, and gives up deeper', () => {
        const b = commitStar("export * from './t';");
        put(`${R}t.ts`, 'export function foo() {}');
        addNew('foo');
        expect(selectChanged(repo, changed, [], { base: b }).related).toContain(BARREL);
        put(`${R}t.ts`, "export * from './u';");
        addNew('bar');
        expect(selectChanged(repo, changed, [], { base: b }).related).toContain(BARREL);
      });

      it('an unresolvable star target is not additive', () => {
        const withGone = `${STAR}export * from './gone';\n`;
        const b = commitStar('export const foo = 1;', withGone);
        addNew('bar', withGone);
        expect(selectChanged(repo, changed, [], { base: b }).related).toContain(BARREL);
      });
    });
  });
});
