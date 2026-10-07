// The full error of every red of an e2e:main run (WP-1044). The row in e2e.jsonl keeps only the first error line; the
// run's worktree is reset on the next run, so the rest is written to metrics/raw/e2e/main-<UTC>-<sha7>.md first.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_MESSAGE_LINES = 80;
export const MAX_TAIL_LINES = 40;
export const KEEP_DAYS = 14;

export const stripAnsi = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');

const outText = (chunks) => (chunks ?? []).map((c) => (typeof c === 'string' ? c : (c.text ?? ''))).join('');

/** The first `max` lines of `text`, with a marker when cut. */
export function capHead(text, max = MAX_MESSAGE_LINES) {
  const lines = stripAnsi(text).split('\n');
  if (lines.length <= max) return lines.join('\n');
  return `${lines.slice(0, max).join('\n')}\n[cut: ${lines.length - max} more lines]`;
}

/** The last `max` lines of `text`, with a marker when cut. */
export function capTail(text, max = MAX_TAIL_LINES) {
  const lines = stripAnsi(text).trimEnd().split('\n');
  if (lines.length <= max) return lines.join('\n');
  return `[cut: ${lines.length - max} earlier lines]\n${lines.slice(-max).join('\n')}`;
}

/** What the details file needs from the last result of one failing Playwright test. */
export function extractDetail(result, retries) {
  const errors = result.errors?.length ? result.errors : result.error ? [result.error] : [];
  const loc = errors.find((e) => e.location)?.location;
  return {
    message: errors.map((e) => e.message ?? '').join('\n'),
    location: loc ? `${loc.file}:${loc.line}:${loc.column ?? 0}` : '',
    stdout: outText(result.stdout),
    stderr: outText(result.stderr),
    attempts: (retries ?? 0) + 1,
    attachments: (result.attachments ?? []).map((a) => a.path).filter(Boolean),
  };
}

/** The markdown file's text: one section per failing test. `entries` are `{ id, detail }`. */
export function renderDetails({ sha, entries }) {
  const out = [`# e2e red on main ${sha.slice(0, 7)}`, ''];
  for (const { id, detail: d } of entries) {
    out.push(`## ${id}`, '');
    if (!d) {
      out.push('(no detail)', '');
      continue;
    }
    out.push(`Attempts: ${d.attempts ?? 1}`);
    if (d.location) out.push(`Location: ${d.location}`);
    out.push('', '### Error', '```', capHead(d.message), '```', '');
    for (const [name, text] of [
      ['stdout', d.stdout],
      ['stderr', d.stderr],
    ])
      if (stripAnsi(text).trim()) out.push(`### ${name} (tail)`, '```', capTail(text), '```', '');
    if (d.attachments?.length) out.push('### Attachments', ...d.attachments.map((p) => `- ${p}`), '');
  }
  return out.join('\n');
}

const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace(':', '-');

/** Deletes `main-*.md` files in `dir` older than KEEP_DAYS. */
export function pruneOld(dir, nowMs) {
  for (const f of readdirSync(dir)) {
    if (!/^main-.*\.md$/.test(f)) continue;
    if (nowMs - statSync(join(dir, f)).mtimeMs > KEEP_DAYS * 86_400_000)
      rmSync(join(dir, f), { force: true });
  }
}

/** Writes the details file into `dir` (created if missing), prunes old ones, returns its repo-relative path. */
export function writeDetails({ dir, relDir = 'metrics/raw/e2e', sha, nowMs, entries }) {
  mkdirSync(dir, { recursive: true });
  const name = `main-${stamp(nowMs)}-${sha.slice(0, 7)}.md`;
  writeFileSync(join(dir, name), renderDetails({ sha, entries }));
  pruneOld(dir, nowMs);
  return `${relDir}/${name}`;
}
