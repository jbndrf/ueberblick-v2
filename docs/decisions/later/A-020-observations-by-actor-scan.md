# A-020 `Facts.observationsByActor` scans observations; no `observations(run_id)` index yet
priority: low        status: provisional
date: 2026-09-30   lead: a   work packages: WP-534.1   touches: R14 / budget

## Context
lead-b's WP-534.1 adds `Facts.observationsByActor(actorId)` for subject erasure. With no `observations(run_id)` index, the server implementation scans every observation. Erasure is a rare admin action.

## Options
- A) Accept the scan. Consequence: no extra cost on each write, and an erasure takes O(observations), which is seconds on a large project.
- B) Add an `observations(run_id)` index. Consequence: every observation insert pays for one more index (the hot write path, docs/12 run budget).

## Chosen (provisional)
A. Erasure is rare, runs in the background as an admin action, and has no interactive budget. The run write path is hot. The seam: the query sits behind `Facts.observationsByActor`, so an index (or a `runs(actor)` join) can be added in a migration without an API change. Revisit if an erasure of a real project takes more than 10 s, measured by `bench/erasure`.

## Cost to change later
now: one migration line · after the build: one migration plus a one-time index build (minutes on large projects)
