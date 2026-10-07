# Kickoff: starting the three leads

The build runs autonomously with three Opus leads in parallel (`lead-loop.md`). The owner starts it once.

1. On the server, in `~/ueberblick-v4`: `npm run leads:setup`. This creates `~/ueberblick-v4-lead-a`, `-lead-b` and `-lead-c` (worktrees with `node_modules`).
2. Open three Claude Code sessions (Opus, permission mode that doesn't stop for prompts, for example `claude --permission-mode bypassPermissions`), one in each worktree. Over SSH, use tmux so they survive disconnects.
3. Give each session the same two lines:

```
Follow docs/process/lead-loop.md. You are the lead named by this worktree (lead-a, lead-b or lead-c).
/goal Every roadmap item in docs/process/roadmap.md is done or marked needs-owner, npm run check is green on main, the docs are current, and docs/process/final-report.md is landed.
```

## What the leads start with
- **lead-a:** WP-010 (project-file schema), WP-011 (golden corpus, capability-driven, never derived from v3 projects), WP-020 (rule-language parser spike + parser; first write `packages/core/src/expr/ast.ts`).
- **lead-b:** WP-030 (core.geo; first write `packages/core/src/geo/contract.ts`), and then refinement of WP-040…050 and the Phase 3/4 contracts it can pull forward.
- **lead-c:** the steward iteration of `lead-loop.md` (spec: the owner's file `metrics/raw/leads/owner-lead-c-spec.md`); no starting work packages, its lane is WP-900 … WP-999.
- WP-010, WP-020 (O2) and WP-030 (O6) contain decisions. The leads make them provisionally and record them as later topics (`docs/decisions/later/`).

The owner can follow along in `~/ueberblick-v4/metrics/raw/leads/*.md` (journals), in `npm run wp`, in `docs/decisions/later/`, and in `npm run metrics`.
