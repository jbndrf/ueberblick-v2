# B-007 Map load budgets: renderer init measured apart from feature delivery; 60k cluster build 1500 ms (×4)
priority: medium      status: provisional
date: 2026-09-30   lead: b   work packages: WP-529, WP-521   touches: R14, docs/12

## Context
WP-529 chunked feature delivery (longest chunk 6.3 ms, 25 ms at ×4) and lazy-loads the renderer. Two numbers stay over budget, both outside our code:
- The browser long task on map load is 167 ms (was 207–263). A CDP profile attributes it to MapLibre itself: module evaluation (~120 ms) and `new Map` plus first render (~174 ms, shader compile under software GL in CI). Feature delivery is ~10 ms.
- `map-cluster-build-60k` is ~330 ms raw, over 1000 ms at the ×4 low-end factor (WP-123.1). The `Supercluster.load` floor is ~240 ms; tuning saves 10–40 ms. It runs in the cluster worker, off the main thread.

## Options
- A) Split the long-task row: "during sync or feature delivery ≤ 100 ms" (unchanged, enforced) and "renderer init (module eval, GL context, first render)" measured and reported separately, judged on a real-GPU device. Set the worker cluster build to ≤ 1500 ms at ×4; cold start (≤ 5 s) remains the user-facing guard.
- B) Own typed-array grid clusterer (different cluster shapes, new code to maintain) to meet 1000 ms.
- C) Keep the budgets and accept red benchmarks.

## Chosen (provisional)
A. Cheapest to undo: the rows can be tightened again without code changes. Seam: the clusterer sits behind the cluster worker's index (`ui/src/map/cluster/index-core.ts`), so B can replace Supercluster without touching the renderer or the host. Follow-up: `ClusterClient.setKeys` with a new key (~130–190 ms main thread at 60k) is chunked in its own work package.

## Cost to change later
now: low · after the build: low (budget rows and one benchmark constant).
