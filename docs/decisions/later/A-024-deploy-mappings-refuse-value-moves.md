# A-024 Breaking deploys that need value moves are refused until mappings execute
priority: medium        status: superseded by C-002 (owner 2026-10-01); implemented by WP-307 (`$move` runs, `deploy_moves`, `packages/server/src/deploy/move-executor.ts`)
date: 2026-09-30   lead: a   work packages: WP-210, WP-171   touches: R3 / docs/user deploy how-to / F13 upgrades

## Context
From course check 004. WP-210 validates breaking-deploy mappings (`{to}` or `{discard}`) and then throws them away. The user docs promise "the server moves the data later as system runs", but nothing stores or executes the mappings, so features silently keep values the new version no longer knows.

## Options
- A) Execute mappings at deploy as system runs (R3). This is correct, but a mapping can touch every feature: 60k runs, batching, idempotence and resumability are all needed. That is a sizeable WP.
- B) Refuse any deploy whose mapping needs a value move (`{to}`), with a clear problem naming the property and values. `{discard}` stays allowed, since nothing has to move. Fix the docs, and keep the mapping type as the seam for A.
- C) Keep the current silent behaviour. Rejected: it gives wrong data.

## Chosen (provisional)
B, because it is cheapest to undo and never produces wrong data. The seam: the mapping type and its validation stay in the plan result; A later adds an executor behind the same `deployProject` (WP-169).

## Cost to change later
now: one refusal plus docs · after the build: A as its own WP (a system-run executor, resumable)
