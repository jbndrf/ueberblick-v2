# A-021 Erasure is an ordinary run of a `redact` task; the admin erasure path is removed
priority: medium        status: provisional (supersedes A-019)
date: 2026-09-30   lead: a   work packages: WP-142.2, WP-534.1   touches: R3 / docs/09

## Context
A-019 kept `Store.submitErasure` plus an admin endpoint (WP-142.1) until core could plan a purge. lead-b's WP-534.1 is on main now: a `then:` step `redact: { subject, of? }` plans nulls through `planRedaction`, and every `PlannedRun` carries `purge` and `erased`. The golden maengelmelder template has an `erase_subject` task.

## Options
- A) Keep the admin endpoint and have it submit a run of the configured erasure task. Consequence: two ways into erasure, and the endpoint duplicates the runs endpoint.
- B) Remove `submitErasure` and the admin endpoint. Erasure is a run of a task with a `redact` step, through the normal runs endpoint. Who may run it comes from the config's roles, like any task. Consequence: one write path (R3), and permissions live in one place.

## Chosen (provisional)
B. It honours R3 and R11 fully: a run is the only write path and no alias is kept. The confirmation speed bump from A-018/A-019 becomes the task's form (a confirm field with a `when` rule), which is the config's business. The seam: `createErasure` stays the single executor, called from the run transaction for any `PlannedRun` with a non-empty `purge`. The post-commit byte delete and the sweeper from WP-142 and WP-142.1 are unchanged.

## Cost to change later
now: delete one endpoint and one store method · after the build: re-add a thin admin route that submits the erasure task (no data change)
