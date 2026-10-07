// One place that knows whether apps/web/build is current (WP-947). demo, seed and journeys call ensureBuilt();
// the specs call isStale() and skip with BUILD_COMMAND in the message. Nobody checks the build file by hand.
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BUILD_COMMAND = 'npm run build -w @ueberblick/web';
const SKIP_DIRS = new Set(['node_modules', '.svelte-kit', 'build']);
const PACKAGES = ['core', 'ui', 'client', 'server', 'builder'];
// the build compiles the message catalogues and the inlang project of the app and every package it ships
const CATALOGUES = ['messages', 'project.inlang'];
const LOCK_STALE_MS = 15 * 60_000;

const buildFile = (root) => join(root, 'apps/web/build/index.js');
const flavourFile = (root) => join(root, 'apps/web/build/.flavour');
const lockFile = (root) => join(root, 'apps/web/.build.lock');

/** Newest mtime (ms) below `dir`, skipping build output and installs; 0 when `dir` is missing. */
function newestIn(dir) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) newest = Math.max(newest, newestIn(join(dir, e.name)));
    } else {
      try {
        newest = Math.max(newest, statSync(join(dir, e.name)).mtimeMs);
      } catch {
        // vanished while walking
      }
    }
  }
  return newest;
}

function newestSource(root) {
  let newest = 0;
  const file = (p) => {
    try {
      newest = Math.max(newest, statSync(p).mtimeMs);
    } catch {
      // absent
    }
  };
  const dirs = ['apps/web', ...PACKAGES.map((p) => `packages/${p}`)];
  try {
    for (const t of readdirSync(join(root, 'packages/tools'), { withFileTypes: true }))
      if (t.isDirectory()) dirs.push(`packages/tools/${t.name}`);
  } catch {
    // no tools
  }
  for (const d of dirs) {
    newest = Math.max(newest, newestIn(join(root, d, 'src')));
    for (const c of CATALOGUES) newest = Math.max(newest, newestIn(join(root, d, c)));
  }
  try {
    for (const f of readdirSync(join(root, 'apps/web')))
      if (/^(svelte|vite)\.config\./.test(f)) file(join(root, 'apps/web', f));
  } catch {
    // no apps/web
  }
  file(join(root, 'package.json'));
  file(join(root, 'apps/web/package.json'));
  return newest;
}

/** Records which kind of build is in `apps/web/build`: `probe` (UB_MAP_PROBE=1, the e2e read-back seam) or `plain`. */
export function writeFlavour(root, flavour) {
  mkdirSync(join(root, 'apps/web/build'), { recursive: true });
  writeFileSync(flavourFile(root), `${flavour}\n`);
}

const flavourOf = (root) => {
  try {
    return readFileSync(flavourFile(root), 'utf8').trim();
  } catch {
    return null;
  }
};

/**
 * True when the build is missing or older than the newest source file it depends on. With a `flavour` it is also
 * stale when the build's marker is missing or names another flavour; without one, any flavour counts (a probe build
 * is a plain build plus a read-back flag).
 */
export function isStale(root = ROOT, { flavour } = {}) {
  if (!existsSync(buildFile(root))) return true;
  if (flavour && flavourOf(root) !== flavour) return true;
  return statSync(buildFile(root)).mtimeMs < newestSource(root);
}

function runBuild(root, { flavour } = {}) {
  const env = flavour === 'probe' ? { ...process.env, UB_MAP_PROBE: '1' } : process.env;
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build', '-w', '@ueberblick/web'], {
      cwd: root,
      stdio: 'inherit',
      env,
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('the web build failed'))));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tryLock(path) {
  try {
    const fd = openSync(path, 'wx');
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/** Whether the lock holder is still around: the pid in the lock is alive, and the lock is younger than 15 minutes. */
function lockHeld(lock) {
  try {
    if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) return false;
    const pid = Number.parseInt(readFileSync(lock, 'utf8'), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
    } catch (e) {
      return e.code !== 'ESRCH';
    }
    return true;
  } catch {
    return false;
  }
}

/** Build when stale, else return at once. Concurrent callers wait for the lock holder; a dead holder's lock is taken over. */
export async function ensureBuilt({ root = ROOT, build = runBuild, pollMs = 200, flavour } = {}) {
  for (;;) {
    if (!isStale(root, { flavour })) return false;
    const lock = lockFile(root);
    if (tryLock(lock)) {
      try {
        if (!isStale(root, { flavour })) return false;
        console.log(`Building the web app (${BUILD_COMMAND}${flavour === 'probe' ? ', probe' : ''}) ...`);
        await build(root, { flavour });
        writeFlavour(root, flavour ?? 'plain');
        return true;
      } finally {
        rmSync(lock, { force: true });
      }
    }
    if (!lockHeld(lock)) rmSync(lock, { force: true });
    await sleep(pollMs);
  }
}

/** Whether a build exists at all (for --no-build, which must not build). */
export const buildExists = (root = ROOT) => existsSync(buildFile(root));

/**
 * The e2e web build is the `probe` flavour (UB_MAP_PROBE=1). A current one is reused (WP-1029); `stale`, `ensure` and
 * `log` are injectable so the spec needs no real build. Returns whether it built.
 */
export async function prepareBuild({
  stale = isStale,
  ensure = ensureBuilt,
  log = console.log,
  root = ROOT,
} = {}) {
  if (!stale(root, { flavour: 'probe' })) {
    log('e2e: web build is current (probe), reused');
    return false;
  }
  log('e2e: building the web app (probe) …');
  return ensure({ root, flavour: 'probe' });
}
