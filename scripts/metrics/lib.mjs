// Shared helpers for development metrics (docs/process/metrics.md).
// Raw events are machine-local JSONL under <main checkout>/metrics/raw (gitignored). All worktrees
// write to the SAME place (resolved via the git common dir), so agent branches are measured too.
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

export function rawDir() {
  try {
    return resolve(git('rev-parse', '--path-format=absolute', '--git-common-dir'), '..', 'metrics/raw');
  } catch {
    return resolve('metrics/raw');
  }
}

export function append(file, entry, dir = rawDir()) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, file), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

/** One entry in ATTENTION.md, the lead's only log input (logwatch, e2e triage). */
export function attention(title, lines, dir = rawDir(), at = new Date()) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, 'ATTENTION.md'),
    `\n## ${at.toISOString().slice(0, 16)} · ${title}\n${lines.map((l) => `- ${l}`).join('\n')}\n`,
  );
}

export function readJsonl(file) {
  const f = join(rawDir(), file);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

export const pct = (xs, p) =>
  xs.length
    ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]
    : null;
export const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
export const ratio = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
export const fmtK = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`;
export const hours = (ms) => (ms === null ? 'n/a' : `${(ms / 3_600_000).toFixed(1)} h`);

/**
 * Current branch, short sha and a hash of uncommitted changes (`tree`), for tagging events. Two runs
 * are 'the same code' only if sha AND tree match; flake detection depends on that.
 */
export function where() {
  try {
    const dirty = execFileSync('git', ['diff', 'HEAD', '--binary'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    const untracked = git('ls-files', '--others', '--exclude-standard');
    return {
      branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      sha: git('rev-parse', '--short', 'HEAD'),
      tree:
        dirty || untracked
          ? createHash('sha1')
              .update(dirty + untracked)
              .digest('hex')
              .slice(0, 8)
          : 'clean',
    };
  } catch {
    return { branch: '?', sha: '?', tree: '?' };
  }
}

/** Work package id from a branch name like wp/WP-012 or wp/WP-012-foo. */
export const wpOf = (branch) => branch?.match(/WP-\d+(?:\.\d+)*/)?.[0] ?? null;

/** `{ gateWaitMs }` from UEB_GATE_WAIT_MS (set by scripts/ops/check-gate.sh: how long the run queued for its slot), else `{}`. */
export function gateWaitField(env = process.env) {
  const raw = env.UEB_GATE_WAIT_MS;
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? { gateWaitMs: Math.round(n) } : {};
}
