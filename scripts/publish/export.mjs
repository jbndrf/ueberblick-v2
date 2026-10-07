#!/usr/bin/env node
// The public GitHub repo gets the product only: `node scripts/publish/export.mjs <dir> [--ref <ref>]` writes the tree
// of <ref> (default HEAD) to <dir> without the paths in scripts/publish/exclude.txt, and drops the package.json
// scripts that call an excluded file. With `--push <git url> --message <text>` it then clones <url>, replaces its
// tree with the export and pushes one commit to main (a snapshot: the dev history never leaves this repo).
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The paths of exclude.txt: one per line, `#` comments and blank lines ignored, no leading or trailing slash. */
export function parseExclude(text) {
  return text
    .split('\n')
    .map((l) =>
      l
        .replace(/#.*/, '')
        .trim()
        .replace(/^\/+|\/+$/g, ''),
    )
    .filter((l) => l !== '');
}

/** The package.json scripts without the ones whose command names an excluded path. */
export function keptScripts(scripts, excluded) {
  const named = (cmd) =>
    excluded.some((p) =>
      new RegExp(`(^|[\\s'"]|\\./)${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|\\s|$)`).test(cmd),
    );
  return Object.fromEntries(Object.entries(scripts).filter(([, cmd]) => !named(cmd)));
}

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})\n${r.stderr ?? ''}`);
  return r;
};

export function exportTree(out, ref = 'HEAD', root = ROOT) {
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).some((f) => f !== '.git')) throw new Error(`${out} is not empty`);
  const tar = run('git', ['-C', root, 'archive', '--format=tar', ref], { encoding: 'buffer' }).stdout;
  run('tar', ['-x', '-C', out], { input: tar, encoding: 'buffer' });
  const excluded = parseExclude(readFileSync(join(out, 'scripts/publish/exclude.txt'), 'utf8'));
  for (const p of excluded) rmSync(join(out, p), { recursive: true, force: true });
  const pkgFile = join(out, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const dropped = Object.keys(pkg.scripts).filter((k) => !(k in keptScripts(pkg.scripts, excluded)));
  pkg.scripts = keptScripts(pkg.scripts, excluded);
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  return { excluded, dropped };
}

function push(url, message, ref) {
  const work = mkdtempSync(join(tmpdir(), 'ueb-publish-'));
  try {
    run('git', ['clone', '--quiet', url, work]);
    for (const f of readdirSync(work))
      if (f !== '.git') rmSync(join(work, f), { recursive: true, force: true });
    exportTree(work, ref);
    run('git', ['-C', work, 'checkout', '-B', 'main']);
    run('git', ['-C', work, 'add', '-A']);
    if (run('git', ['-C', work, 'status', '--porcelain']).stdout === '')
      return console.log('nothing to publish');
    run('git', ['-C', work, 'commit', '--quiet', '-m', message]);
    run('git', ['-C', work, 'push', '--quiet', 'origin', 'main'], { stdio: 'inherit' });
    console.log(`pushed: ${message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const ref = opt('--ref') ?? 'HEAD';
  const url = opt('--push');
  if (url) {
    const message = opt('--message');
    if (!message) throw new Error('--push needs --message');
    push(url, message, ref);
  } else {
    const out = args.find((a, i) => !a.startsWith('--') && !['--ref'].includes(args[i - 1]));
    if (!out || existsSync(join(out, 'package.json')))
      throw new Error('usage: export.mjs <empty dir> [--ref <ref>]');
    const { excluded, dropped } = exportTree(resolve(out), ref);
    console.log(
      `exported ${ref} to ${out}: ${excluded.length} paths excluded, scripts dropped: ${dropped.join(' ')}`,
    );
  }
}
