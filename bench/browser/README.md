# bench/browser

Real-browser benchmarks for the UI budgets of `docs/12-performance-budgets.md` (WP-528). Chromium headless, CPU x4, Fast 4G. How and when to run: `docs/process/metrics.md`, section "Browser benchmarks".

```bash
npm run bench:browser                       # all scenarios, median of 3, fails on a missed budget
npm run bench:browser -- --only map-60k --runs 1
npm run bench:browser -- --self-test        # scenarios slowed on purpose must fail
npm run bench:browser:test                  # fast unit tests of the tooling
```

## Profiling a spike (WP-541)

Pan/zoom long tasks are enforced on the median of >= 3 runs under software GL; the single-run max is printed as `info (not judged)` next to the table, and a real-GPU run is authoritative (B-008). Single spikes of 100-900 ms are SwiftShader `clear`/`drawElements`/`bufferData` stalls inside MapLibre (WP-541).

`BENCH_PROFILE_DIR=<dir> npm run bench:browser -- --only map-60k --runs 1` writes a CDP CPU profile and the long tasks of the pan/zoom phase into `<dir>`; `node bench/browser/lib/attribute.mjs <dir> [minMs]` prints the inclusive busy time by script and the hottest stacks of each long task. Profile and long tasks are aligned by the phase end, so the per-task stacks are approximate; the by-script totals are exact.

## Profiling an open (WP-549)

`BENCH_PROFILE_DIR=<dir> npm run bench:browser -- --only task-sheet-50 --runs 1` (also `form-50-fields`) builds unminified and writes a CDP CPU profile of the click-to-paint window as `<name>-<time>.cpuprofile`. Profiling adds overhead: read the shares, not the milliseconds. Fixtures that compile a project belong in page load (`lib/task-world.ts` `prepare`), never in the click handler.

## Layout

- `scenarios/<page>/`: one Vite page per scenario (`index.html`, `main.ts`, sometimes a `Page.svelte`). It mounts the real components from `packages/ui` with seeded, generated data and reports through `window.__bench` (`lib/probe.ts`: long tasks, named metrics, `ready`).
- `scenarios.mjs`: the runner side. One driver per scenario returns `{label, budget, value}` rows; budgets are the docs/12 rows (`bench/harness/budget.mjs`) or a `defineBudget` of this work package.
- `run.mjs` (CLI), `lib/build.mjs` (Vite build and static server), `lib/browser.mjs` (launch, throttling, CDP heap), `lib/libs.mjs` (scripted system-library setup), `lib/verdict.mjs` (judging, table), `lib/data.ts` (fixtures).

## Add a scenario (for example 3D, H1)

1. Add `scenarios/<page>/index.html` and `main.ts` (call `installProbe()`, set `bench.ready = true`).
2. Add a driver and an entry to `SCENARIOS` in `scenarios.mjs`. A 3D renderer is the map page with another renderer, or its own page; the runner knows no renderer names.
3. Call `slowdown()` (`lib/probe.ts`) at the measured moment so `--self-test` can prove the scenario fails when slow.

## Notes

- `sync-snapshot-60k` (WP-560): the real sync worker and device store on real IndexedDB pull 60 snapshot pages of 1,000 features (3 observations and 1 edge each) from an in-memory server (`lib/sync-world.ts`) into an empty store. Rows: longest task (enforced `long-task`, 100 ms; it covers the whole pull, so it is the worst page), total offline copy (`offline-copy-60k`, 30 s; the device's share, no network) and JS heap. The long task includes the in-page page generation (about 1 % of the busy time); the per-page `applyPage` wall time is printed as `info`. `BENCH_PROFILE_DIR` also writes a CPU profile and prints every long task. The self-test blocks the thread once, mid-snapshot.
- `BENCH_SYNC_HOST=inthread` runs the `sync-snapshot-60k` pipeline on the main thread (the WP-565 baseline); the default is the dedicated sync worker (B-012, WP-567).
- `?slow=<ms>` blocks the main thread on purpose (test mode only).
- MapLibre 6 loads its worker from a file beside its main module. `lib/build.mjs` copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` next to the bundled chunk; the app build needs the same.
- Verdicts are `PASS`, `FAIL` and `INFO`. `INFO` marks a report-only row: measured and shown against a reference limit, never failing (a NaN still fails). Only budgets listed in `REPORT_ONLY_BUDGETS` (`lib/verdict.mjs`) may be report-only, today `map-renderer-init` (MapLibre module evaluation, GL context, first render; judged on a real GPU, B-007); `judge` throws on the flag for any other row. The map scenario splits long tasks at the moment the map subscribes to features: before it is renderer init (`INFO`), after it is feature delivery (enforced at 100 ms).
- `list-60k` and `filter-change-60k` (WP-859): one page (`scenarios/list`, fixture `lib/list-world.ts`: 60k trees on `MemoryIndex`, the real view source). `list-60k` runs the Liste's chunked read as `MapCanvas` does and reports the time to rows against the warm-start row (3 s) plus the longest task; `filter-change-60k` hides and shows the Objektart through the real `filteredSource` with a one-hop view filter and judges the longest task against `filter-change-60k` (100 ms).
