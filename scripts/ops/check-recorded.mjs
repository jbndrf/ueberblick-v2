#!/usr/bin/env node
// Asks whether a commit's exact git tree already has a green FULL `npm run check` recorded in
// metrics/raw/tests.jsonl (WP-906). Exit 0 and print the record, or exit 1 and say why.
// Usage: node scripts/ops/check-recorded.mjs <branch|sha>
// `--kind changed` (WP-953) also accepts a green check:changed run. The land train runs the one full check.
import { pathToFileURL } from 'node:url';
import { git, readJsonl } from '../metrics/lib.mjs';

/**
 * What a test:record run was. `check`: no extra args under the check gate (only `npm run check` does
 * that, after check:fast, boundaries and bench:harness passed). `scoped`: any extra vitest args.
 * `test`: no args outside a check. Bare `npm test` is never recorded.
 */
export function kindOf(args, env) {
  if (args.length > 0) return 'scoped';
  return env.UEB_GATE_HELD ? 'check' : 'test';
}

/**
 * Decides over recorded lines. `ref` is { tree: git tree hash, sha: full commit hash }. Pure.
 * Lines from before `kind` existed (no `kind`) are kept readable but never count as a full check.
 */
export function judge(records, ref) {
  const same = records.filter((r) =>
    r.gitTree ? r.gitTree === ref.tree : typeof r.sha === 'string' && ref.sha.startsWith(r.sha),
  );
  if (same.length === 0) return { ok: false, reason: 'no record for this tree' };
  const full = same.filter((r) => r.kind === 'check');
  if (full.length === 0) {
    const kinds = [...new Set(same.map((r) => r.kind ?? 'untyped (recorded before kind existed)'))];
    return { ok: false, reason: `only ${kinds.join(', ')} runs recorded, no full check` };
  }
  const clean = full.filter((r) => r.tree === 'clean');
  if (clean.length === 0) return { ok: false, reason: 'the full check ran on a dirty worktree' };
  const sound = clean.filter((r) => !r.crashed);
  if (sound.length === 0) return { ok: false, reason: 'the full check crashed' };
  const green = sound.filter((r) => r.exitCode === 0);
  if (green.length === 0) return { ok: false, reason: 'the full check was red' };
  return { ok: true, record: green[green.length - 1] };
}

/**
 * A full check counts only when the tests row (`judge`) AND the outermost `check` suite line of
 * check-steps.jsonl are green for the exact tree (WP-1022): the steps run in parallel, so test:record can
 * finish green while check:fast or boundaries turn red; the outer line carries the whole run's result.
 * Pure. Returns { ok: true, record } or { ok: false, reason }.
 */
export function judgeCheck(tests, steps, ref) {
  const v = judge(tests, ref);
  if (!v.ok) return v;
  const outer = steps.filter(
    (r) => r.suite === 'check' && !r.parent && r.gitTree === ref.tree && r.ownPackages !== false,
  );
  if (outer.length === 0) return { ok: false, reason: 'no outer check suite line for this tree' };
  const clean = outer.filter((r) => r.tree === 'clean');
  if (clean.length === 0) return { ok: false, reason: 'the outer check ran on a dirty worktree' };
  if (!clean.some((r) => r.exitCode === 0)) return { ok: false, reason: 'the outer check suite was red' };
  return v;
}

/**
 * `--kind changed` (WP-953): a green `npm run check:changed` of the exact tree counts (a `changed` suite
 * line in check-steps.jsonl, run on a clean tree, outermost), and so does a green full check (`judge`).
 * Pure. Returns { ok: true, record, via: 'changed' | 'check' } or { ok: false, reason }.
 */
export function judgeChanged(tests, steps, ref) {
  const full = judgeCheck(tests, steps, ref);
  if (full.ok) return { ok: true, record: full.record, via: 'check' };
  const same = steps.filter(
    (r) =>
      r.suite === 'changed' &&
      !r.parent &&
      r.ownPackages !== false &&
      (r.gitTree ? r.gitTree === ref.tree : false),
  );
  if (same.length === 0)
    return { ok: false, reason: `no check:changed record for this tree (${full.reason})` };
  const clean = same.filter((r) => r.tree === 'clean');
  if (clean.length === 0) return { ok: false, reason: 'check:changed ran on a dirty worktree' };
  const green = clean.filter((r) => r.exitCode === 0);
  if (green.length === 0) return { ok: false, reason: 'check:changed was red' };
  return { ok: true, record: green[green.length - 1], via: 'changed' };
}

function main(argv) {
  const kindAt = argv.indexOf('--kind');
  const kind = kindAt >= 0 ? argv[kindAt + 1] : 'check';
  const rest = kindAt >= 0 ? argv.filter((_, i) => i !== kindAt && i !== kindAt + 1) : argv;
  const ref = rest[0];
  if (!ref || (kind !== 'check' && kind !== 'changed')) {
    console.error('usage: check-recorded.mjs <branch|sha> [--kind check|changed]');
    return 2;
  }
  let resolved;
  try {
    resolved = { tree: git('rev-parse', `${ref}^{tree}`), sha: git('rev-parse', `${ref}^{commit}`) };
  } catch {
    console.error(`check-recorded: cannot resolve ${ref}`);
    return 2;
  }
  if (kind === 'changed') {
    const c = judgeChanged(readJsonl('tests.jsonl'), readJsonl('check-steps.jsonl'), resolved);
    if (!c.ok) {
      console.log(`no green check:changed or full check recorded for ${ref}: ${c.reason}`);
      return 1;
    }
    console.log(
      `green ${c.via === 'changed' ? 'check:changed' : 'full check'} recorded for ${ref} (tree ${resolved.tree.slice(0, 10)}): at ${c.record.at}, wallMs ${c.record.wallMs}`,
    );
    return 0;
  }
  const v = judgeCheck(readJsonl('tests.jsonl'), readJsonl('check-steps.jsonl'), resolved);
  if (!v.ok) {
    console.log(`no green full check recorded for ${ref}: ${v.reason}`);
    return 1;
  }
  const r = v.record;
  console.log(
    `green full check recorded for ${ref} (tree ${resolved.tree.slice(0, 10)}): at ${r.at}, wallMs ${r.wallMs}, passed ${r.passed}, skipped ${r.skipped}`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)));
