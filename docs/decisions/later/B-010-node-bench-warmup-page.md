# B-010 Node long-task benches exclude one JIT warm-up page; cold start is judged in the browser bench
priority: medium      status: provisional
date: 2026-09-30   lead: b   work packages: WP-548, WP-123.1, WP-528   touches: R14, docs/12

## Context
WP-123.1 applies the ×4 low-end factor to Node benches, so the 100 ms long-task row is 25 ms raw there. client-store-plan-worst is 5–8 ms per page in steady state, but page 0 costs 29–30 ms raw (V8 cold JIT plus the first large allocations). That is 115–121 ms at ×4, and it fails 3 of 3. fold-page-worst shows the same pattern. Multiplying a cold-JIT spike by 4 does not model a phone: the phone's own cold start is measured in bench/browser with real CPU throttling (cold start ≤ 5 s, long task during sync ≤ 100 ms).

## Options
- A) Node per-page long-task benches run and report one warm-up page as an info line, and judge the worst of the remaining pages at ×4. Cold-start cost is judged only by bench/browser (throttled CPU, real IndexedDB).
- B) Split the first commit so page 0 stays under 25 ms raw (more code for a Node-only artefact).
- C) Keep judging page 0 at ×4 (red benches that measure JIT, not our code).

## Chosen (provisional)
A. The warm-up page stays visible (info line), steady-state regressions still fail, and the phone's first-page long task is covered by the browser bench's sync long-task row. Seam: `bench/harness` takes a `warmup: 1` option per bench, so B can later be adopted per bench.

## Cost to change later
now: low · after the build: low.
