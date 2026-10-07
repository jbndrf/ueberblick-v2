// WP-1004: vitest's global setups generate code (Paraglide messages, `svelte-kit sync`) that is almost always up to
// date. A stamp holds the hash of a step's inputs; a step whose stamp matches and whose outputs exist is skipped.
// Stamps live in `node_modules/.cache/codegen-stamps/` of the checkout (link-node-modules never shares `.cache`).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Longest measured step: 4.0 s (web messages compile, 10 steps in parallel, cold). A step that holds the lock
// refreshes its mtime every third of the limit, so even a longer compile never loses it.
const STALE_LOCK_MS = 60_000;

/** sha1 over the sorted paths and contents of the inputs (a missing file hashes as absent), plus `extra`. */
export function inputsHash(files, extra = '') {
  const h = createHash('sha1');
  for (const f of [...files].sort()) {
    h.update(`${f}\0`);
    h.update(existsSync(f) ? readFileSync(f) : 'absent');
    h.update('\0');
  }
  h.update(`extra\0${extra}`);
  return h.digest('hex');
}

/** True only if the stamp holds `hash` and every output path exists. */
export function upToDate(stampFile, hash, outputs) {
  if (!existsSync(stampFile)) return false;
  if (readFileSync(stampFile, 'utf8').trim() !== hash) return false;
  return outputs.every((o) => existsSync(o));
}

/** Atomic: a temp file in the same directory, then a rename. */
export function writeStamp(stampFile, hash) {
  mkdirSync(dirname(stampFile), { recursive: true });
  const tmp = `${stampFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, hash);
  renameSync(tmp, stampFile);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Exclusive lock: `mkdir` fails when the directory exists. A lock whose mtime is older than `staleMs` is taken over;
 * the holder touches the mtime while `fn` runs, so only a dead holder's lock ever goes stale.
 */
export async function withLock(lockDir, fn, { staleMs = STALE_LOCK_MS, pollMs = 25 } = {}) {
  mkdirSync(dirname(lockDir), { recursive: true });
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > staleMs)
          rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // released meanwhile
      }
      await sleep(pollMs);
    }
  }
  const beat = setInterval(
    () => {
      try {
        const now = new Date();
        utimesSync(lockDir, now, now);
      } catch {
        // lock removed
      }
    },
    Math.max(1, Math.floor(staleMs / 3)),
  );
  try {
    return await fn();
  } finally {
    clearInterval(beat);
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/** Runs one step unless up to date. Re-checks the stamp after getting the lock. Forced by UEB_CODEGEN_FORCE=1. */
export async function runStep(step, root = defaultRoot) {
  const dir = join(root, 'node_modules/.cache/codegen-stamps');
  const stamp = join(dir, step.name);
  const force = process.env.UEB_CODEGEN_FORCE === '1';
  const fresh = () => {
    const { files, extra } = step.inputs();
    return { hash: inputsHash(files, extra), files };
  };
  if (!force && upToDate(stamp, fresh().hash, step.outputs)) return 'skipped';
  return withLock(`${dir}/${step.name}.lock`, async () => {
    const { hash } = fresh();
    if (!force && upToDate(stamp, hash, step.outputs)) return 'skipped';
    await step.run();
    writeStamp(stamp, hash);
    return 'ran';
  });
}

const versionFile = (root, pkg) => join(root, 'node_modules', pkg, 'package.json');

/** The package.json that names the version of a plugin module file: the nearest one above it (within `root`). */
function modulePackageJson(moduleFile, root) {
  for (let d = dirname(moduleFile); d.startsWith(root); d = dirname(d)) {
    if (existsSync(join(d, 'package.json'))) return join(d, 'package.json');
  }
  return moduleFile;
}

/** Paraglide compile of one inlang project: inputs are the settings, the messages files they point to, the compiler. */
export function paraglideStep(project, outdir, root = defaultRoot) {
  const projectDir = join(root, project);
  return {
    name: `paraglide-${project.replace(/[^a-z0-9]+/gi, '-')}`,
    inputs: () => {
      const settingsFile = join(projectDir, 'settings.json');
      const files = [settingsFile, versionFile(root, '@inlang/paraglide-js')];
      let extra = '';
      if (existsSync(settingsFile)) {
        const s = JSON.parse(readFileSync(settingsFile, 'utf8'));
        for (const m of s.modules ?? []) {
          if (/^[a-z]+:\/\//i.test(m)) extra += `url ${m}\n`;
          else files.push(modulePackageJson(resolve(projectDir, m), root));
        }
        const pattern = s['plugin.inlang.messageFormat']?.pathPattern;
        for (const locale of s.locales ?? []) {
          if (pattern) files.push(resolve(dirname(projectDir), pattern.replace('{locale}', locale)));
        }
      }
      return { files, extra };
    },
    outputs: [join(root, outdir, 'messages.js')],
    run: async () => {
      await run('npx', ['paraglide-js', 'compile', '--project', projectDir, '--outdir', join(root, outdir)], {
        cwd: root,
      });
    },
  };
}

function listRoutes(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listRoutes(join(dir, e.name), base) : [join(dir, e.name).slice(base.length)],
  );
}

/** `svelte-kit sync` of apps/web: inputs are its configs, the route tree (names only), app.d.ts and the kit version. */
export function kitSyncStep(root = defaultRoot) {
  const web = join(root, 'apps/web');
  return {
    name: 'svelte-kit-sync',
    inputs: () => ({
      files: [
        join(web, 'svelte.config.js'),
        join(web, 'vite.config.ts'),
        join(web, 'src/app.d.ts'),
        versionFile(root, '@sveltejs/kit'),
      ],
      extra: listRoutes(join(web, 'src/routes')).sort().join('\n'),
    }),
    outputs: [join(web, '.svelte-kit/tsconfig.json')],
    run: async () => {
      await run('npm', ['exec', '-w', '@ueberblick/web', '--', 'svelte-kit', 'sync'], { cwd: root });
    },
  };
}

/** Every step the vitest global setups need: ui, builder, each tool, the web app's messages, and kit sync. */
export function allSteps(root = defaultRoot) {
  const tools = readdirSync(join(root, 'packages/tools'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, 'packages/tools', e.name, 'project.inlang')))
    .map((e) => `packages/tools/${e.name}`);
  return [
    paraglideStep('packages/ui/project.inlang', 'packages/ui/src/paraglide', root),
    paraglideStep('packages/builder/project.inlang', 'packages/builder/src/paraglide', root),
    ...tools.map((t) => paraglideStep(`${t}/project.inlang`, `${t}/src/paraglide`, root)),
    paraglideStep('apps/web/project.inlang', 'apps/web/src/lib/participant/paraglide', root),
    kitSyncStep(root),
  ];
}

let all;
/** All steps run concurrently, once per process: the first global setup starts them, the others await the same run. */
export function runAllCodegen(root = defaultRoot) {
  all ??= Promise.all(allSteps(root).map((s) => runStep(s, root))).then(() => undefined);
  return all;
}

// CLI (`npm run typecheck:gen`): run every step, fail loudly.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAllCodegen().catch((e) => {
    console.error(e.stderr ?? e.message ?? e);
    process.exit(1);
  });
}
