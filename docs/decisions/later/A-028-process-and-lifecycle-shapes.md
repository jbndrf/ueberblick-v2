# A-028 Shapes of the process, the lifecycle and value moves
priority: high        status: provisional (shapes only; the owner decided the concepts in C-002)
date: 2026-10-01   lead: a   work packages: WP-304, WP-305, WP-306, WP-307   touches: R4 / docs/04 / docs/05 / docs/06 / glossary "stage"

## Context
The owner decided the concepts (C-002, `docs/research/v3-parity/stages-intent.md`, QUESTIONS.md Q23, Q24, Q28 and "Stages and lifecycle"):
- one process per Objektart, with start and end stages;
- a system lifecycle aktiv / abgeschlossen / archiviert / gelöscht, changed only through runs;
- reaching an end stage completes an entry only through a rule;
- system audit metadata;
- deploys move values.

This record fixes the **shapes** the engine uses for them. They are cheap to change before projects exist.

## Chosen (provisional)
1. **Process on the type:** `types.<t>.process: { property, start, end: [..] }`.
   - `property` names a `select` property of the type. `start` is one of its options and `end` lists at least one.
   - `start` replaces `default` for that property: compile refuses a `default` on it.
   - The process property is written only by `then.set` steps (v3: only `transition` wrote the stage, `task-run.ts:450,517`). A form field or a quick-edit field on it is a compile problem.
   - Core exposes `processesOf(type)` as a **list** (0 or 1 today). That is the seam for a second process.
2. **Lifecycle:** one reserved key `$lifecycle`, with values in a registry (`LIFECYCLE_STATES`: `active`, `completed`, `archived`, `deleted`).
   - **It replaces `$deleted`** (R11: one source, no alias).
   - `$type` starts a feature as `active` in fold. Creation writes no extra observation.
   - It is written by a `then` step kind `lifecycle: <state>`. Rules use the same step.
     - Setting `deleted` also needs `permissions.delete` for bound actors.
     - `completed` → `active` is the "reopen" step (v3 allowed runs on completed features).
   - Runs on an `archived` or `deleted` feature are refused `case_closed` (v3 `task-run.ts:390-391`).
   - `archived` and `deleted` features are not served to devices; sync treats them like today's tombstones. Admin reads see all four states.
3. **Audit metadata:** `$created_by` is written once by plan on create (the actor id). Fold derives `created_at` (the `$type` observation's time) and `changed_at` (the newest observation's time).
   - Rules read the system fields as `self.$lifecycle`, `self.$created_by`, `self.$created_at` and `self.$changed_at`. The `$` sigil follows A-005's reserved-word convention.
4. **Value moves:** `{ to }` mappings run after the version switch as **system runs of a reserved built-in task `$move`**, which only actor kind `system` may run.
   - Moves are batched and resumable: pending moves are rows in the project DB, and a restart continues them.
   - A select option move rewrites the value. In a multiselect it replaces the value inside the list. A property move copies the value to the new key.
   - Template `migrations` can reuse the same executor later.

## Options not chosen
- Lifecycle as two keys (`$deleted` kept plus `$status`): two sources for "gone".
- A lifecycle step per state (`complete`, `archive`, …): four step kinds for one write.
- Audit metadata from a server-side join of runs: the device could not show or evaluate it (rule "the device shows what is on the device").

## Cost to change later
- now: a few registry and schema lines;
- after projects exist: a file migration per changed key name, and a re-fold.
