// WP-955: the base of `npm run check:changed`. A branch that is a few lands behind main must not see what main
// changed since the branch point, so the base is the merge-base with main and never main's tip. Vitest then adds
// the uncommitted and untracked changes itself (`--changed <sha>`). On main itself the merge-base is HEAD, so
// only uncommitted changes count.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { changedFiles, selectChanged } from './changed-select.mjs';
import { messageEntries, i18nScript } from './rerun-triggers.mjs';

/** The commit where this branch left `ref`. */
export const mergeBase = (cwd, ref) =>
  execFileSync('git', ['merge-base', ref, 'HEAD'], { cwd, encoding: 'utf8' }).trim();

/**
 * WP-1006: the `selection` field of a scoped tests.jsonl row, from the plan `vitestArgs` returned: `reason` is the
 * line that decided "all tests", or "related". A missing plan or a plan without a selection is "unknown", never a crash.
 */
export function recordedSelection(plan) {
  const sel = plan?.selection;
  if (!sel || typeof sel.all !== 'boolean') return { all: false, reason: 'unknown', seeds: 0 };
  return { all: sel.all, reason: String(sel.reason ?? 'unknown'), seeds: sel.seeds ?? 0 };
}

/**
 * The vitest command line for test-record. Without `--changed <ref>`: `run` and the arguments as given.
 * With it: the merge-base diff goes through `selectChanged`; a blanket trigger runs everything, otherwise
 * `related <files>` runs the affected specs. Returns the selection lines to print.
 */
export async function vitestArgs(args, cwd, changes = null) {
  const at = args.indexOf('--changed');
  if (at < 0 || at + 1 >= args.length) return { argv: ['run', ...args], lines: [] };
  const base = mergeBase(cwd, args[at + 1]);
  const rest = args.filter((_, i) => i !== at && i !== at + 1);
  const { files, deleted } = changes ?? changedFiles(cwd, base);
  const sel = selectChanged(cwd, files, deleted, { base });
  // the reason is the line that decided "all tests" (the last line when a later step, such as a missing compile, did)
  const everything = (lines) => ({
    argv: ['run', ...rest],
    lines,
    selection: {
      all: true,
      reason: lines.findLast((l) => /all tests/.test(l)) ?? lines.at(-1) ?? 'unknown',
      seeds: 0,
    },
  });
  if (sel.all) return everything(sel.lines);
  // The compiled Paraglide entries are git-ignored, and in a fresh worktree they do not exist yet when
  // `vitest related` builds its graph (the global setup compiles later). Run the packages' own global setups
  // first; an entry still missing means the graph is incomplete, so run everything.
  const entries = messageEntries(cwd);
  for (const pkg of sel.messagePackages) {
    if (existsSync(`${cwd}/${pkg}/vitest.global-setup.ts`)) {
      // a query string, so a second call runs the setup again instead of reusing the cached module
      const setup = pathToFileURL(`${cwd}/${pkg}/vitest.global-setup.ts`);
      await (await import(`${setup.href}?t=${Date.now()}`)).default();
    } else {
      // WP-989: a tool package has no setup of its own (packages/tools/vitest.global-setup.ts compiles all of them
      // later), so run the package's own i18n script, which is what `npm run i18n` does for it.
      try {
        execFileSync('npm', ['run', i18nScript(cwd, pkg), '--silent'], {
          cwd: `${cwd}/${pkg}`,
          stdio: 'ignore',
        });
      } catch {
        // the entry check below reports it
      }
    }
    if (!existsSync(`${cwd}/${entries[pkg]}`))
      return everything([...sel.lines, `compiled messages of ${pkg} missing after compile -> all tests`]);
  }
  // `vitest related` with no files would run everything; a path nothing imports selects nothing.
  const list = sel.related.length ? sel.related : ['scripts/ops/.no-affected-files'];
  return {
    argv: ['related', ...list, '--run', ...rest],
    lines: [...sel.lines, `selected: ${sel.related.length} changed files and reader specs -> vitest related`],
    selection: { all: false, reason: 'related', seeds: sel.related.length },
  };
}
