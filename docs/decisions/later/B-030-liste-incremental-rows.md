# B-030 The Liste draws rows incrementally
priority: low        status: provisional
date: 2026-10-05   lead: b   work packages: WP-862   touches: budget (list-time-to-rows-60k, heap-60k)

## Context
v3 had no Liste (owner M1 keeps only the toggle), so the row-drawing strategy is ours. With 48k rows in the DOM, `list-60k` took 24 s and 284 MB.

## Options
- A) Incremental rows: first 100 rows per table, 100 more near the end of the scroll or when focus reaches the last drawn row. Nothing the person sees changes; cheapest to undo.
- B) True windowing: constant DOM size, but row heights and sticky header need care, and screen readers and find-in-page lose rows.
- C) Paging UI or a row cap: a new visible element or hidden rows, which the owner has not decided.

## Chosen (provisional)
A. The table states its full size (`aria-rowcount`, `aria-rowindex`), captions keep the full count, a sort orders all rows then redraws from the top. The seam is `packages/ui/src/map/feature-list/incremental.ts` (`first`, `more`, `nearEnd`); windowing or paging replaces that module.

## Cost to change later
now: one module and the `FeatureList.svelte` wiring. After the build: the same, no data or API change.
