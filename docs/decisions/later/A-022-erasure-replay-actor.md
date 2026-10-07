# A-022 Backup restore replays erasures as an admin restore actor
priority: high        status: provisional
date: 2026-09-30   lead: a   work packages: WP-142.2, WP-536   touches: R3 / docs/09 (GDPR Art. 17) / docs/process/backup.md

## Context
After a restore, the erasures newer than the snapshot must be re-applied, or erased personal data comes back. WP-142.2 made erasure an ordinary run (A-021), so replay re-submits the original erasure run. But `submit` re-checks permissions, and the journal holds no actor roles (runs don't store them). A participant-run erasure whose task `when` needs a role is therefore **refused** on replay, and the data is resurrected.

## Options
- A) Replay under the original actor with its roles. Needs roles recorded at erase time (a migration on lead-b's `erasure_runs`, plus a way for `submit` to accept given roles). Exact audit, but a core/server contract change.
- B) Replay under a dedicated admin actor (`restore`), keeping the original actor id and run id in the journal entry and the replayed run's input. Needs no schema change; admin-kind actors pass the erasure task. The audit shows the restore operator as actor, which is honest: they re-applied it.
- C) Skip the permission check on replay. A second write path (R3), so rejected.

## Chosen (provisional)
B, because it is cheapest to undo and fully inside the run path. A refusal on replay stays a loud failure naming the entry, never a silent skip. The seam: replay's actor comes from one function (`replayActor(entry)` in `scripts/backup/replay.mjs`), so A can replace it once roles are recorded per run.

## Cost to change later
now: one function · after the build: a migration recording the actor's roles per erasure run, plus swapping `replayActor`
