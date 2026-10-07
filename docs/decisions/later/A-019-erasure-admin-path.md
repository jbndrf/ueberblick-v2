# A-019 Erasure runs through an admin store path until the rule-driven `redact` step exists
priority: medium        status: provisional
date: 2026-09-30   lead: a   work packages: WP-142, WP-142.1, WP-534.1   touches: R3 / docs/09 (personal data)

## Context
WP-142 wired lead-b's `createErasure(db).erase` into the run transaction. The rule-driven source of a purge (`PlannedRun.purge` from a `redact` then-step, WP-534.1) wasn't on main yet, so the purge comes from `planRedaction` through `Store.submitErasure({ run, subject, pairs })`. That path records a run in the ledger and folds in the same transaction (R3 holds), but it does not go through `core.plan` or permissions.

## Options
- A) Keep `submitErasure` as an admin-only path, and authorise it at the HTTP edge (admin session plus a confirmation). Consequence: a second entry into the write path, with no permission check inside it.
- B) Wait for WP-534.1, and run erasure only as a normal run whose task has a `redact` step. Consequence: permissions come from the config, and there is one path, but there is no erasure before 534.1 lands.
- C) Both: A now, then fold A into B once 534.1 lands (delete `submitErasure`, R11).

## Chosen (provisional)
C. Erasure is a legal duty (GDPR Art. 17), so it can't wait. `submitErasure` stays unreachable except from one admin endpoint (WP-142.1). Once WP-534.1 is on main, a follow-up routes erasure through a `redact` task and deletes `submitErasure`. The seam: `StoreDeps.erasure` (the executor port) and `StoreDeps.onOrphanedBlobs` (the post-commit byte delete) are shared by both paths.

Also recorded:
- `blob` tombstones must survive any future tombstone compaction until the sweeper has deleted the bytes.
- `fileBlobStore.delete` unlinks the file and doesn't shred it; disk-level erasure is an operations matter (docs/09).

## Cost to change later
now: one admin endpoint · after the build: delete `submitErasure` and its endpoint, and add a `redact` task to the templates (no data migration)
