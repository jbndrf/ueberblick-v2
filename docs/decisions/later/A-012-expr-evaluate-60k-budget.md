# A-012 Full rule evaluation over 60k features: budget derived from delta-visible, not long-task
priority: medium        status: provisional
date: 2026-09-30   lead: a   work packages: WP-123.1, WP-127   touches: R14, docs/12, budget

## Context
WP-123.1 derived `expr-evaluate-60k` (50 ms) and `expr-evaluate-relation-60k` (100 ms) from the main-thread long-task row, but both run in a worker. With honest ports (a real lookup per read, a context per feature, as `plan/rules.ts` and `plan/scope.ts` do), WP-127 measured 19 ms raw → 77 ms x4 and 27 → 110 ms x4 at load avg ~40. A handwritten predicate over the same port already costs 14–17 ms raw, so the 50 ms limit is unreachable by the evaluator by design. Evaluating a rule over *all* features is never per interaction (R14): it happens on load or after a config change; per-interaction work is incremental.

## Options
- A) Re-derive from `delta-visible-1s`: a full re-evaluation after a config change in a worker, limits 100 ms (`when`) and 150 ms (relation) after x4 (chosen).
- B) Keep 50/100 ms and make FeatureAccess cheaper (columnar store, batched reads) — a port redesign across client and server.
- C) Drop the rows.

## Chosen (provisional)
A, cheapest to undo; it keeps a regression gate at about 1.3× today's cost. The seam: the `FeatureAccess` port; option B is a new adapter behind it (a columnar/batched port) plus tighter limits, without evaluator changes.

## Cost to change later
small: two bench limits; B is a port adapter WP (client + server) if profiling on real phones shows full re-evaluation hurts.
