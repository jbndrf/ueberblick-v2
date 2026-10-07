# bench/

Reproducible, seeded benchmarks for the budgets in `docs/12-performance-budgets.md`. Data is generated from a seed (60k features by default) and never committed. Hot-path work packages add one folder each here (e.g. `bench/expr-evaluate`, `bench/geo`).

## Run

```bash
npm run bench        # every bench/**/*.bench.ts (or `npm run bench -- <dir or path>` for some; a filter matching nothing exits 64), one file at a time (so benches never measure each other), prints the budget lines, writes the result, exits non-zero on a breach
npm run bench:harness # harness tests (every bench reports a budget line); part of `npm run check`, about 3 s
npm run bench:test   # harness plus the 60k generator test; not part of `npm run check`
npm test -- -c bench/vitest.config.ts bench/geo   # one folder, without the budget summary
```

`bench/filters` runs unbundled through vitest, not through an esbuild bundle like `bench/expr-evaluate`, because the golden assets it loads use `import.meta.glob`. Its number is therefore an upper bound.

## Typecheck

`bench/tsconfig.json` (root config plus the DOM lib) covers every `.ts` here. `npm run typecheck:bench` runs it, and `npm run typecheck` (so `check:fast`, the pre-commit hook and `check`) includes it, so a contract change breaks the bench in the same commit instead of at the next `npm run bench`. A bench that builds `projectStoresFor` deps takes `blobs` from `benchBlobs()` (`bench/server-run/seed-config.ts`), the runtime's `fileBlobStore` in a temp dir with an `onError` that throws.

## Reporting a budget (harness)

A benchmark is a vitest file `bench/<area>/<name>.bench.ts`. To take part in the summary it reports a measured value against a budget:

```ts
import { DOC_BUDGETS, defineBudget, report } from '../harness/budget.mjs';
report(DOC_BUDGETS['bbox-query-p95']!, p95Ms); // a row of the docs/12 table, server code
report(docBudget('long-task', { device: 'x4', thread: 'worker' }), ms); // a row, measured on this machine
report(
  defineBudget({
    id: 'derive-60k',
    limit: 300,
    unit: 'ms',
    derivedFrom: 'run-endpoint-p95: ...', // or row: '<docs/12 row id>'; the text names the row it derives from
    device: 'x4',
    thread: 'worker',
  }),
  medianMs,
);
```

**Judge a budget only with `assertBudget(report(budget, value))`** (WP-913). It applies the load-aware verdict: over budget on a busy machine is `UNRELIABLE` (returns), over `HARD_FACTOR` x the limit, on a quiet machine or under `--strict` / `BENCH_STRICT=1` it throws. Never write `expect(ms).toBeLessThan(limit)` in a bench: it ignores load and fails a busy machine (`scripts/guardrails.spec.ts` rejects it). Correctness asserts (counts, plans) stay plain `expect`.

A bench that renders a Svelte component starts with `// @vitest-environment jsdom` (the bench config has the Svelte plugin) and reports `x4` (jsdom time x4).

Every budget names its docs/12 row (`row`) or says how its limit derives from one (`derivedFrom`, which names the row), and how it was measured (`device`). `defineBudget` throws otherwise, and the harness test checks every call in `bench/`:

| `device`   | Meaning                                                                                      | Compared as                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `x4`       | Runs on the phone, measured on this machine. Needs `thread` (`main`, `worker` or `n/a`).     | time values x 4 (`DEVICE_FACTOR`, the CPU throttle of the docs/12 reference phone); sizes unscaled |
| `server`   | Server code (1 vCPU reference).                                                              | as measured                                                                                        |
| `dev-only` | Desktop tooling such as the builder. Proves no device row.                                   | as measured                                                                                        |
| `measured` | Already measured on the device profile (`npm run bench:browser`), or a size or memory value. | as measured                                                                                        |

A line shows the raw value, the adjusted value in parentheses and the verdict: `bench fold-page-worst: 17.2 ms (x4: 68.8 ms) / 100 ms  PASS  [x4, worker]`. `thread: 'main'` on an `x4` line means the work runs on the main thread. After the lines, `npm run bench` prints the 13 rows of docs/12 with their worst adjusted value from lines that **are** the row (`row`), the number of lines that only derive from it (`derived`), or `unmeasured`; the last `npm run bench:browser` result counts as well. `metrics/raw/bench/<date>.json` has the same as `rows`.

`DOC_BUDGETS` holds one entry per row of the docs/12 table (the units are the table's). A budget is an upper limit: a value above it is a breach. `report` prints `bench <id>: <value> <unit> / <limit> <unit>  PASS|FAIL`.

`npm run bench` prints all lines again at the end, writes `metrics/raw/bench/<date>.json` (`{date, ok, vitestExit, lines[], rows[]}`) and appends `{name, value, raw, unit, budget, row, device}` (`value` is the adjusted value) to `metrics/raw/bench.jsonl` (section 6 of `npm run metrics`). The exit code is non-zero when a budget is exceeded or a benchmark test fails. Every `*.bench.ts` must call `report` (the harness test `bench/harness/harness.spec.ts` fails otherwise), so no benchmark is missing from the summary. A benchmark that also asserts fails the run too. Reuse a docs/12 row only in one bench (the summary keeps the last value per id); use `defineBudget` with a distinct id otherwise.

## Load is not failure (WP-153)

Timings on a shared machine are inflated (on the build VM the load average runs at 45 to 80 on 64 cores). `report` records the load per core (1-minute load average / cores) next to every value, and prints it: `... PASS  [server]  load 0.4/core`. A time value (ms, s) over its limit taken while the load per core is above `LOAD_LIMIT_PER_CORE` (0.5) gets the verdict `UNRELIABLE` instead of `FAIL`:

| Verdict      | When                                                                                              | Exit code of `npm run bench`                |
| ------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `PASS`       | value within the limit, at any load                                                               | 0                                           |
| `FAIL`       | over the limit with load per core at most 0.5, or above `HARD_FACTOR` (2) x the limit at any load, or any size line (KB, MB: bytes do not depend on load) over its limit | non-zero |
| `UNRELIABLE` | over the limit, load per core above 0.5                                                           | 0, with a warning; rerun on a quiet machine |

**Hard ceiling:** a value above `HARD_FACTOR` (2, one constant in `bench/harness/budget.mjs`) x its limit is `FAIL` at any load; load does not explain a doubling. **Strict mode:** `npm run bench -- --strict` (or `BENCH_STRICT=1`) treats `UNRELIABLE` as `FAIL`. The summary re-lists every `UNRELIABLE` line at the end. **The phase-end report (roadmap) must run in strict mode**, on a machine with low load, so `UNRELIABLE` cannot hide a breach. The budget itself never moves. The result file and `bench.jsonl` carry `load` and `verdict` per line. A benchmark does not assert on a time (the harness judges it, otherwise the assertion fails the run under load); `BENCH_LOAD_PER_CORE=<n>` pins the load in the harness tests. To get a trustworthy number, run when `uptime` shows a low load, or take the minimum of several runs.

## Generator

`bench/generate` builds the 60k-feature dataset of `fixtures/golden/bench-spec.yaml` (baumkataster 1.0.0) into a project database through the WP-100 driver:

```ts
import { generate } from './generate/generate';
const { db, digest, stats } = generate({ seed: 4711, features: 60_000 }); // dir: '/tmp/x' for a file instead of memory
```

- Same seed: byte-identical rows (`digest` is a hash over every inserted value in order).
- Types and counts follow the spec's proportions; clusters scale with the size so the density stays the same. About 77 % of the trees lie inside an area (spec: about 70 %), 25 % are assigned, 40 % have inspection history, some points carry Z (H1).
- 60k features take about 7 s on the dev machine.
- Until the run store exists (WP-104), rows are inserted directly (runs, observations, folded features, derived edges). `config_versions.compiled` is a placeholder. Switch to real runs once WP-104 lands.
