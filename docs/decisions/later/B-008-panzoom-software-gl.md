# B-008 Pan/zoom long-task row: median under software GL, real GPU authoritative
priority: medium      status: provisional
date: 2026-09-30   lead: b   work packages: WP-539, WP-541   touches: R14, docs/12, B-007

## Context
Once WP-539 made the pan/zoom long-task row measurable, about 3 in 25 single runs of the map-60k scenario exceed 100 ms (122–886 ms). The rest read 0 ms. WP-541's CDP profiles attribute all main-thread time in those spikes to MapLibre and native WebGL calls under SwiftShader, e.g. 801 ms inside one `clear` call, and `bufferData` and `drawElements` at 4–6× their normal cost. No frame from packages/ui appears in any profile.

## Options
- A) Keep the row enforced at ≤ 100 ms, judged on the median of ≥ 3 runs (`--runs 3`) under software GL. Report the single-run maximum alongside as information. A real-GPU device run is authoritative, as B-007 already says for renderer init.
- B) Make the row report-only (INFO) under SwiftShader.
- C) Enforce every single run. This fails about 12 % of CI runs on noise outside our code.

## Chosen (provisional)
A. The budget still bites on a systematic regression in our code, and it is not weakened in the allowlist sense of WP-529: the row is not in REPORT_ONLY_BUDGETS. Seam: the verdict takes the run aggregate, so a real-GPU runner can switch to per-run enforcement without changing the scenarios.

## Cost to change later
now: low · after the build: low (one aggregation choice in bench/browser).
