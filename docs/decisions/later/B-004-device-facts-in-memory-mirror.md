# B-004 Device Facts: synchronous in-memory mirror over IndexedDB, history warmed on demand
priority: medium        status: provisional
date: 2026-09-29   lead: b   work packages: WP-510, WP-511   touches: R14 (device heap), R2 (Facts port), H4

## Context
The core `Facts` port is synchronous (core.plan must stay pure and sync), but IndexedDB is async. WP-510 had to bridge the two.

## Options
- A) Keep features, edges and blob keys in an in-memory mirror, loaded at open and updated after each commit; load capped history on demand (`await warmHistory(ids)` before planning; a cold read throws `history_not_warm`).
- B) Make `Facts` async across core: every plan/evaluate becomes async; simpler device code, slower and more complex core.
- C) Pre-compute the facts a run can touch (via `bind`) and hand plan a snapshot object per run.

## Chosen (provisional)
A. It keeps core sync and matches docs/07 ("in-memory indexes rebuilt through core.fold"). Heap is bounded by the docs/12 budget (≤ 150 MB total for 60k features; the store's share is measured in bench/client-store). The seam: `Facts` is a port, so C can replace the mirror per run without touching core.

## Cost to change later
now: low · after the build: medium (client store + run queue; core unchanged). Risk: very large projects (> 60k features) may need C or scope-limited mirrors.
