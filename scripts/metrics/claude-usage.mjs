// Claude token usage from Claude Code transcripts (~/.claude/projects/<repo-slug>*/**.jsonl).
// Worktrees of this repo get their own slug with the same prefix, so they are included.
// One API response can appear on several transcript lines: dedupe by message id.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { git, wpOf } from './lib.mjs';

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

/** Agent type of a subagent transcript (Claude Code writes agent-<id>.meta.json next to it). */
function agentType(file) {
  const meta = file.replace(/\.jsonl$/, '.meta.json');
  if (!existsSync(meta)) return 'subagent';
  try {
    return JSON.parse(readFileSync(meta, 'utf8')).agentType ?? 'subagent';
  } catch {
    return 'subagent';
  }
}

/** Returns one row per API response inside [since, until). */
export function claudeUsage(since, until = new Date()) {
  const top = git('rev-parse', '--path-format=absolute', '--git-common-dir').replace(/\/\.git$/, '');
  const slug = top.replace(/[^a-zA-Z0-9]/g, '-');
  const root = join(homedir(), '.claude/projects');
  if (!existsSync(root)) return [];
  const rows = new Map();
  for (const d of readdirSync(root).filter((d) => d.startsWith(slug))) {
    for (const f of files(join(root, d))) {
      if (statSync(f).mtime < since) continue;
      const role = f.includes('/subagents/') ? agentType(f) : 'lead';
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line.includes('"assistant"')) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        const m = o.message;
        if (o.type !== 'assistant' || !m?.usage || !m.id) continue;
        const at = new Date(o.timestamp);
        if (at < since || at >= until) continue;
        const u = m.usage;
        rows.set(m.id, {
          at,
          model: m.model ?? '?',
          role,
          wp: wpOf(o.gitBranch) ?? (/^(main|lead-[ab])$/.test(o.gitBranch ?? '') ? o.gitBranch : 'other'),
          input: u.input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
        });
      }
    }
  }
  return [...rows.values()];
}
