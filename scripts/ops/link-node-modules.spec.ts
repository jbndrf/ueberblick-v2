import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARKER, ensureNodeModules, installMatchesLock, linkRefusal } from './link-node-modules.mjs';
import { specEnv } from '../testing/spec-env.mjs';

// Real npm against a fixture repo whose dependencies are local tarballs: no registry, no network.
// main and the worktrees are siblings of tgz/, so the relative `file:` specs resolve the same everywhere.
let base: string;
let main: string;
const TIMEOUT = 120_000;

const cleanEnv = () => {
  const env = Object.fromEntries(Object.entries(specEnv()).filter(([k]) => !/^npm_/i.test(k)));
  return { ...env, npm_config_cache: join(base, 'npm-cache'), npm_config_update_notifier: 'false' };
};
const npm = (cwd: string, ...args: string[]) =>
  execFileSync('npm', [...args, '--offline', '--no-audit', '--no-fund'], {
    cwd,
    env: cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: specEnv({
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    }),
  });
const write = (f: string, text: string) => {
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, text);
};
const json = (o: unknown) => JSON.stringify(o, null, 2) + '\n';
const tgz = (name: string, version: string) => `file:../tgz/${name}-${version}.tgz`;

function pack(name: string, version: string) {
  const dir = join(base, 'src', `${name}-${version}`);
  write(join(dir, 'package.json'), json({ name, version, main: 'index.js' }));
  write(join(dir, 'index.js'), `module.exports = '${name}@${version}';\n`);
  npm(dir, 'pack', '--pack-destination', join(base, 'tgz'));
}

// A repeat runs the tests again against the same fixture, so every worktree gets a fresh name.
let seq = 0;
function worktree(label: string) {
  const name = `${label}-${++seq}`;
  const wt = join(base, name);
  git(main, 'worktree', 'add', '-q', '-b', name, wt);
  return wt;
}

type Snap = Map<string, { ino: number; mtimeMs: number; hash: string }>;
/** Every regular file under dir: inode, mtime and content hash. */
function snapshot(dir: string): Snap {
  const out: Snap = new Map();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const s = statSync(p);
        out.set(p.slice(dir.length), {
          ino: s.ino,
          mtimeMs: s.mtimeMs,
          hash: createHash('sha1').update(readFileSync(p)).digest('hex'),
        });
      }
    }
  };
  walk(dir);
  return out;
}
/** Paths of `before` whose file is gone or differs now. */
const changed = (dir: string, before: Snap) =>
  [...before].filter(([rel, b]) => {
    const now = snapshot(dir).get(rel);
    return !now || now.ino !== b.ino || now.mtimeMs !== b.mtimeMs || now.hash !== b.hash;
  });
const inode = (f: string) => lstatSync(f).ino;
const req = (dir: string, pkg: string) => readFileSync(join(dir, 'node_modules', pkg, 'index.js'), 'utf8');
const noCi = () => {
  throw new Error('npm ci must not run');
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'link-nm-'));
  mkdirSync(join(base, 'tgz'));
  for (const [n, v] of [
    ['fx-dep', '1.0.0'],
    ['fx-dep', '2.0.0'],
    ['fx-extra', '1.0.0'],
  ] as const)
    pack(n, v);
  main = join(base, 'main');
  write(
    join(main, 'package.json'),
    json({
      name: 'fx-root',
      private: true,
      workspaces: ['packages/*'],
      dependencies: { 'fx-dep': tgz('fx-dep', '1.0.0') },
    }),
  );
  write(join(main, 'packages/a/package.json'), json({ name: '@fx/a', version: '1.0.0' }));
  write(join(main, '.gitignore'), 'node_modules/\n');
  npm(main, 'install');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'init');
  // runtime caches a tool wrote into main's install
  write(join(main, 'node_modules/.vite/deps.json'), '{}');
  write(join(main, 'node_modules/.cache/x'), 'x');
}, TIMEOUT);
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('link', () => {
  it('hardlinks packages, copies top-level files, skips caches and marks the copy', () => {
    const wt = worktree('wt-link');
    const r = ensureNodeModules({ worktree: wt, main, npmCi: noCi });
    expect(r.action).toBe('linked');
    expect(inode(join(wt, 'node_modules/fx-dep/index.js'))).toBe(
      inode(join(main, 'node_modules/fx-dep/index.js')),
    );
    const hidden = 'node_modules/.package-lock.json';
    expect(inode(join(wt, hidden))).not.toBe(inode(join(main, hidden)));
    expect(readFileSync(join(wt, hidden), 'utf8')).toBe(readFileSync(join(main, hidden), 'utf8'));
    expect(existsSync(join(wt, 'node_modules/.vite'))).toBe(false);
    expect(existsSync(join(wt, 'node_modules/.cache'))).toBe(false);
    expect(JSON.parse(readFileSync(join(wt, 'node_modules', MARKER), 'utf8')).main).toBe(main);
  });

  it('workspace links resolve to the worktree, not to main', () => {
    const wt = worktree('wt-ws');
    ensureNodeModules({ worktree: wt, main, npmCi: noCi });
    expect(realpathSync(join(wt, 'node_modules/@fx/a'))).toBe(realpathSync(join(wt, 'packages/a')));
  });

  it('leaves an existing node_modules alone', () => {
    const wt = worktree('wt-exists');
    write(join(wt, 'node_modules/own.txt'), 'mine');
    expect(ensureNodeModules({ worktree: wt, main, npmCi: noCi }).action).toBe('exists');
    expect(readdirSync(join(wt, 'node_modules'))).toEqual(['own.txt']);
  });

  it('dry run changes nothing', () => {
    const wt = worktree('wt-dry');
    expect(ensureNodeModules({ worktree: wt, main, dryRun: true, npmCi: noCi })).toMatchObject({
      action: 'dry-run',
      reason: 'would link',
    });
    expect(existsSync(join(wt, 'node_modules'))).toBe(false);
  });
});

describe('allowLockMismatch (WP-968)', () => {
  const differing = (label: string) => {
    const wt = worktree(label);
    write(join(wt, 'package-lock.json'), readFileSync(join(wt, 'package-lock.json'), 'utf8') + ' ');
    return wt;
  };

  it('links main install despite a differing lockfile, never npm ci', () => {
    const wt = differing('wt-allow');
    const r = ensureNodeModules({ worktree: wt, main, allowLockMismatch: true, npmCi: noCi });
    expect(r.action).toBe('linked');
    expect(existsSync(join(wt, 'node_modules', MARKER))).toBe(true);
  });

  it('still refuses when main has no node_modules', () => {
    const wt = differing('wt-allow-nomain');
    const empty = mkdtempSync(join(base, 'empty-main-'));
    writeFileSync(join(empty, 'package-lock.json'), 'x');
    expect(linkRefusal(wt, empty, { allowLockMismatch: true })).toBe('main has no node_modules');
  });

  it('the default keeps refusing on a lockfile mismatch', () => {
    const wt = differing('wt-default');
    expect(linkRefusal(wt, main)).toBe("package-lock.json differs from main's");
  });

  it('replaces a real copy (not linked) with the link', () => {
    const wt = worktree('wt-replace');
    mkdirSync(join(wt, 'node_modules'));
    write(join(wt, 'node_modules/real.txt'), 'x');
    const r = ensureNodeModules({ worktree: wt, main, replace: true, npmCi: noCi });
    expect(r.action).toBe('linked');
    expect(existsSync(join(wt, 'node_modules/real.txt'))).toBe(false);
    expect(existsSync(join(wt, 'node_modules', MARKER))).toBe(true);
  });
});

describe('falls back to npm ci', () => {
  it('when the worktree lockfile differs from main', () => {
    const wt = worktree('wt-lockdiff');
    write(join(wt, 'package-lock.json'), readFileSync(join(wt, 'package-lock.json'), 'utf8') + ' ');
    const calls: string[] = [];
    const r = ensureNodeModules({ worktree: wt, main, npmCi: (cwd) => (calls.push(cwd), 0) });
    expect(r).toMatchObject({ action: 'npm-ci', reason: "package-lock.json differs from main's" });
    expect(calls).toEqual([wt]);
    expect(existsSync(join(wt, 'node_modules'))).toBe(false);
  });

  it('when main has no node_modules', () => {
    const wt = worktree('wt-nomain');
    const empty = mkdtempSync(join(base, 'empty-main-'));
    writeFileSync(join(empty, 'package-lock.json'), readFileSync(join(wt, 'package-lock.json')));
    expect(linkRefusal(wt, empty)).toBe('main has no node_modules');
    expect(ensureNodeModules({ worktree: wt, main: empty, npmCi: () => 0 }).action).toBe('npm-ci');
  });

  it("when main's install is stale against its own lockfile", () => {
    const lock = {
      packages: {
        '': {},
        'node_modules/a': { version: '1.0.0', integrity: 'x' },
        'node_modules/b-darwin': { version: '1.0.0', optional: true },
        'node_modules/@s/ws': { resolved: 'packages/ws', link: true },
      },
    };
    const hidden = {
      packages: {
        'node_modules/a': { version: '1.0.0', integrity: 'x' },
        'node_modules/@s/ws': { resolved: 'packages/ws', link: true },
      },
    };
    expect(installMatchesLock(lock, hidden)).toBeNull(); // optional platform package not installed: fine
    const older = {
      packages: { ...hidden.packages, 'node_modules/a': { version: '0.9.0', integrity: 'y' } },
    };
    expect(installMatchesLock(lock, older)).toMatch(
      /node_modules\/a: version 0\.9\.0 installed, 1\.0\.0 locked/,
    );
    const missing = { packages: { 'node_modules/@s/ws': hidden.packages['node_modules/@s/ws'] } };
    expect(installMatchesLock(lock, missing)).toBe('node_modules/a is locked but not installed');
    const extra = { packages: { ...hidden.packages, 'node_modules/gone': { version: '1.0.0' } } };
    expect(installMatchesLock(lock, extra)).toBe('installed node_modules/gone is not in package-lock.json');
  });
});

describe('no write-through (real npm, offline tarballs)', () => {
  it(
    'npm i, upgrade, uninstall and install in a linked worktree never change a file in main',
    () => {
      const wt = worktree('wt-write');
      ensureNodeModules({ worktree: wt, main, npmCi: noCi });
      const before = snapshot(join(main, 'node_modules'));
      npm(wt, 'install', `fx-dep@${tgz('fx-dep', '2.0.0')}`); // upgrade a linked package
      npm(wt, 'install', `fx-extra@${tgz('fx-extra', '1.0.0')}`, '-w', 'packages/a'); // add
      npm(wt, 'uninstall', 'fx-extra', '-w', 'packages/a'); // remove
      git(wt, 'checkout', '--', 'package.json', 'package-lock.json', 'packages/a/package.json');
      npm(wt, 'install'); // back to the committed lock
      expect(req(wt, 'fx-dep')).toContain('fx-dep@1.0.0');
      expect(changed(join(main, 'node_modules'), before)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "land's `npm install` on main after a lockfile change never changes a file in a linked worktree",
    () => {
      const wt = worktree('wt-land');
      ensureNodeModules({ worktree: wt, main, npmCi: noCi });
      const before = snapshot(join(wt, 'node_modules'));
      try {
        npm(main, 'install', `fx-dep@${tgz('fx-dep', '2.0.0')}`); // what land.sh runs after a lock change
        npm(main, 'install', `fx-extra@${tgz('fx-extra', '1.0.0')}`);
        npm(main, 'uninstall', 'fx-extra');
        expect(req(main, 'fx-dep')).toContain('fx-dep@2.0.0');
        expect(req(wt, 'fx-dep')).toContain('fx-dep@1.0.0');
        expect(changed(join(wt, 'node_modules'), before)).toEqual([]);
        // main's lock moved on: the next worktree on the old lock is refused and gets npm ci instead
        const next = worktree('wt-after-land');
        expect(ensureNodeModules({ worktree: next, main, npmCi: () => 0 }).reason).toBe(
          "package-lock.json differs from main's",
        );
      } finally {
        // main is shared by every repeat: put its lock and install back to the committed state
        git(main, 'checkout', '--', 'package.json', 'package-lock.json');
        npm(main, 'install');
      }
    },
    TIMEOUT,
  );
});
