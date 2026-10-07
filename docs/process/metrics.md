# Development metrics

We measure so that course checks argue from numbers and we can see the **effects** of process changes, such as a new prompt, a different model or smaller work packages. Metrics are for steering, never targets. A number that is gamed, like tests written to raise a count, is worse than no number.

**Live dashboard:** http://192.168.1.90:8790 ("Überblick Metrics", `~/lab/ueberblick-dash/server.mjs`, outside the repo, read-only over `metrics/raw/`, refreshes every 30 s; `PORT=… REPO=… node server.mjs` to run another). Machine-level numbers (gate queue waiters, CPU, agent time on tools vs model, GPU idle) come from `python3 ~/lab/fleet-monitor/fleet_report.py --hours 1 --no-history`; the local model's review-FAIL fix rounds are logged in `~/lab/qwen-fix/runs.jsonl` (`qwen_fix.py report --hours N`, `qwen_fix.py budget`). lead-c reads all of them every steward iteration.

`npm run metrics` prints the report. `npm run metrics -- --out` writes `metrics/reports/<date>.md`, and every course check commits one. Raw events are machine-local JSONL in `metrics/raw/` (gitignored). All worktrees write to the main checkout's `metrics/raw/`.

## What is measured, and why

| # | Area | Metric | Source | Healthy (initial guess, recalibrate at course checks) |
|---|---|---|---|---|
| 1 | Delivery (DORA, adapted) | work packages merged per day | WP events | stable or rising |
| | | cycle time p50/p90 (start → merged) | WP events | p50 < 1 day |
| | | change failure rate: fix or revert commits for merged work ÷ merged WPs | `Fixes-WP:` trailer, reverts | < 15% |
| | | red main: count and time to recover | `tests.jsonl` on `main` | 0; recovery < 1 h |
| 2 | Review and rework | review rounds per WP, first-pass PASS rate | WP events | first pass ≥ 60% |
| | | escalations, blocked hours | WP events | low; each one explained |
| 3 | Quality | test count on `main` over time | `tests.jsonl` | grows with the code |
| | | red runs on branches (implementers hitting red is normal; a trend is the signal) | `tests.jsonl` | — |
| | | flaky candidates: a test failing and passing on identical code (same commit and working tree) | `tests.jsonl` | 0 |
| | | suite wall time, slowest tests | `tests.jsonl` | `npm run check` < 2 min |
| | | workers, peak RSS of the process tree, CPU use per run | `tests.jsonl` | CPU use rises with workers; peak RSS far below RAM |
| | | check wall time per suite (`check`, `changed`, `fast`, `typecheck`, `lint`) and per step, red step, 1-min load at start (WP-930). Compare a step only against runs at a similar load. A suite run with `steps.mjs --parallel` (the `typecheck` suite, WP-981) carries `parallel: true`, and so do its group steps (not the `--before` step); each step's `ms` is its own time, `wallMs` the suite's, which is about the slowest step plus the `--before` step | `check-steps.jsonl` | the slowest step sets the next optimisation |
| | | guardrail hook blocks per rule (which rules agents trip over) | `guardrails.jsonl` | falling per WP |
| 4 | Claude cost | tokens by model, role (lead or agent type) and work package; cache hit rate; output tokens per merged WP | Claude Code transcripts | cache hit > 80% |
| 5 | Local model | docsync runs, tokens in/out/reasoning, time, bounces, invented names, Opus outcomes (as-is, edited, rejected), rework ratio, review latency | `docsync.jsonl` | see `docsync.md` |
| 6 | Performance | latest value per benchmark vs. budget (docs/12) | `bench.jsonl` | all within budget |
| 7 | Server health | logwatch digests, hard alarms, local-model tokens, tuning proposals, open ATTENTION.md | `logwatch.jsonl` | no open alarms (`logwatch.md`) |
| 8 | e2e triage | runs, failures by class (app-bug, test-bug, flaky, env, unknown), local-model tokens (in, out, image) and time | `e2e.jsonl` | no `app-bug` (`e2e-triage.md`) |
| 8b | Waiting (WP-1023) | e2e runs of the last 24 h (count, total minutes, wall p50/p90, gate wait, red and infra runs; split by caller and mode) and land latency of the last 7 days (hours from the last `review n PASS` to `merged` per WP, share refused at least once on the way, WPs passed but not merged) | `e2e-runs.jsonl`, `work/events` | — (it shows where agents wait) |
| 9 | Journeys | runs, verdicts (`passes`, `blocked-at`, `docs-mismatch`, `ux-issue`, `a11y`), candidates ready or unstable, actions, screenshots, model calls, findings (high), findings accepted by a lead (`accepted` stays null until a lead judges them), local-model tokens (in, out, image) and time | `journeys.jsonl` | most candidates ready; `blocked-at` rare (`journeys.md`) |

Later, once the code exists: coverage and mutation score for `packages/core` (tools not installed yet; add them in a work package when core has real logic).

## Conventions that feed the numbers (binding)
- **Lead events** go to `work/events/<WP>.log` (folded in by the WP's land), only via `npm run wp:event -- WP-012 start` (and `review 1 FAIL`, `review 2 PASS`, `blocked`, `unblocked`, `escalated`; in the report `escalated` reads "escalated (rewritten/re-dispatched)": a lead rewrote or re-dispatched the package, not an owner escalation). `npm run land` writes `merged <sha>` and, when it refuses a branch, `refused check|install|conflict` (written with the next successful land; the output carries the step and first failing line; the report counts them as red lands, older `reverted …` events included). Until land folds them they sit in `<git common dir>/land-pending/<WP>.log` (never committed, never removed by housekeep); `flow.mjs`, `housekeep` and other readers read committed plus pending lines (`eventLines` in `scripts/metrics/flow.mjs`). They are kept out of the work-package file so they never conflict with the implementer's branch.
- **Fixes of merged work** carry the commit trailer `Fixes-WP: WP-012`.
- **Tests** run through `npm run check`, which calls `npm run test:record` and records every run. Plain `npm test` stays available for quick loops and is not recorded. Each line carries `gitTree` (git tree of the committed HEAD) and `kind`: `check` (no extra args, run by `npm run check`), `test` (no args, outside a check) or `scoped` (extra vitest args). Older lines have neither and are never taken as a full check. `node scripts/ops/check-recorded.mjs <branch|sha>` exits 0 and prints the record when that exact tree has a clean, non-crashed, green `check` line, else exits 1 with the reason; `--kind changed` also accepts a green `check:changed` run of the tree (a `changed` suite line in `check-steps.jsonl`, clean tree). Reviewers use that instead of a second check; the full check runs once per land train (WP-953). Each line also carries `budgetMb`, the planned MB per worker the run's worker count was computed with (measured from recent rows of the same kind, 512 to 1024; WP-986), and `youngWeight` (weight of other runs started under 60 s earlier), `byCpu` and `byMem` (the two limits `workers` is the minimum of, at least 1; WP-995) and `memShareMb` (the memory the run was allowed; the budget ratchet compares `peakRssMb` with 80% of it; WP-998), so the limit is visible. Lines written under the check gate also carry `gateWaitMs`: how long the run queued for its slot (`steps.mjs` writes it to `check-steps.jsonl`, `test:record` to `tests.jsonl`). A run that exits non-zero with zero failed tests (a suite that failed to load, an unhandled error, a worker crash) carries `silentRed`: `{ kind: 'suite', file, message }`, `{ kind: 'unhandled', message }` or `{ kind: 'unknown', tail }`, at most 2 kB (WP-1013; how to read it: `docs/process/flakes.md`). `failing` stays test names only.
- **docsync branches** are closed only with `npm run docsync:outcome`.
- **Benchmarks** append `{"name","value","raw","unit","budget","row","device","load","verdict"}` lines (`value` is the value after the device factor: node benches of device code are multiplied by 4, see `docs/12`; `raw` is as measured; `load` is the load per core at the time of the measurement; `verdict` is PASS, FAIL or UNRELIABLE) to `metrics/raw/bench.jsonl` (`npm run bench`, `bench/harness`, also writes `metrics/raw/bench/<date>.json`; see `bench/README.md`). Budgets are asserted only through the harness: a bench wraps its line as `assertBudget(report(...))`, which throws on FAIL and never on UNRELIABLE (load-aware, `--strict` counts UNRELIABLE as FAIL); a raw `expect(ms).toBeLessThan(...)` in a bench is rejected by `scripts/guardrails.spec.ts`. Every bench reports at least one line, and every budget names its docs/12 row or its derivation; `npm run check` runs the harness test that enforces this. `npm run bench` runs the bench files one at a time (`fileParallelism: false` in `bench/vitest.config.ts`): a budget row is one operation on the device, and files running side by side inflated lines by 40 to 70 percent (WP-921); the suite's wall-clock duration is printed and stored as `durationMs` in `metrics/raw/bench/<date>.json`. It also prints the 13 docs/12 rows with their current adjusted value or "unmeasured" (also stored as `rows` in `metrics/raw/bench/<date>.json`).
- **Property-test failures are reproducible.** `vitest.setup.ts` configures fast-check globally: a failing property prints `seed` and `path` (verbose report). Replay with `FC_SEED=<seed> npm test -- <spec>` (add the printed `path` via `fc.assert(..., { path })` temporarily if the shrink is needed). A generator must never produce inputs the property does not cover (reserved words, names that collide with declared ones): filter them in the generator. Never fix a flake by pinning a seed.
- Branch names of work packages contain the id (`wp/WP-012…`), so tokens are attributed to it.

## Browser benchmarks
Budgets that jsdom and Node cannot prove (interaction to next paint, long tasks, first markers, heap) are measured in a real headless Chromium with the reference device profile of docs/12: CPU x4, Fast 4G (60 ms, 9 Mbit/s), software GL. Code and scenarios: `bench/browser/` (README there).

- **Run:** `npm run bench:browser` (all scenarios, median of 3 runs; `-- --only map-60k`, `-- --runs 1`). It builds the pages, prints a table and exits non-zero when a budget is missed. Results also go to `bench/browser/.results/latest.json` (git-ignored).
- **When:** at every phase end (the lead copies the numbers into `docs/process/roadmap.md`) and before merging a work package that touches a hot path of the UI (form, shell, map, cluster worker). It takes about 3 minutes, so it is not part of `npm run check`.
- **Self-test:** `npm run bench:browser -- --self-test` slows every scenario on purpose (`?slow=<ms>`) and passes only when each one fails its budget. Run it after changing the runner. `npm run bench:browser:test` runs the fast unit tests of the tooling (fixtures, verdict, library setup).
- **Setup is scripted.** The runner installs the Playwright headless shell when it is missing. If Chromium's system libraries are missing it downloads the Debian packages with `apt-get download` (no root), unpacks them into `bench/browser/.libs` and sets `LD_LIBRARY_PATH`. A library it cannot map to a package is an error, never a skip.
- **Scenarios:** form with 50 fields (open, keystroke), task sheet open, shell first render and initial JS, map with 60k features (cold and warm start, cluster build, long tasks on load and on pan/zoom by real mouse input, heap), one-feature update (delta visible, main-thread cost).
- **Limits of the numbers:** software GL, so the GPU cost of a phone is not measured; the JS heap is the page's only (the cluster worker's heap is not included); CDP CPU throttling may not slow workers; fixtures are generated (seeded), not the golden dataset.

## Parity (how far is the rebuild, in percent)
`npm run -s parity` prints, per step of `docs/process/rebuild.md` §5 and in total, the count of v3 elements by status, `% done` and `% verified`. `npm run -s parity -- --missing` also lists the `missing` and `owner` elements per step. It reads only `metrics/parity/elements.json` and warns on a duplicate id, an unknown status or step, an entry without evidence, and a `verified` entry whose evidence is not a spec path with a line.
The weekly report (`npm run -s metrics`, section 1) carries one row, "parity (v3 elements)": the total `% done` and `% verified`, read through `parity.mjs` (`scripts/metrics/parity-rows.mjs`; WP-1015).

`metrics/parity/elements.json` has one entry per v3 element: the rows of the element tables in the six register files (`docs/research/v3-parity/register/{p1,p2,p3,a1,a2,a3}-*.md`), the deliverables of `step-1-plan.md` for step 1 and the one step-4 item no register row carries (sub-process links). Fields: `id` (stable, `<register>.<slug>`), `step` (1 to 5; register p* is step 2, a1 and a2 step 3, a3 step 4, except the items of the step 5 row: chat, consent and legal pages, offline packs, info pages, GIS tokens, project delete, opt-in tools, personal preferences), `register` (file and heading), `label`, `status`, `evidence`, `checked` (date), optional `note`.

| Status | Meaning | `evidence` must be |
|---|---|---|
| `verified` | An e2e or journey spec drives it | `<spec path>:<line>` (a `test.fixme` is no evidence) |
| `built` | Code exists and a work package is done, no spec drives it | `WP-xxx` |
| `missing` | No code | the grep or the work package note that shows it |
| `owner` | Parked on an open owner question | `QUESTIONS.md <id>` |
| `dropped` | An owner decision removed it | the decision, by its name |

`% done = (verified + built) / (all - dropped)`; `% verified = verified / (all - dropped)`. When unsure, use the lower status and add a `note`.

**Updating:** the lead (or the implementer) who lands a work package that ports or removes an element changes its entry in the same commit: `missing` becomes `built` with the WP id, and `built` becomes `verified` when a spec drives it (path and line). A new element row in a register gets a new entry. Entries are never deleted; a removed element becomes `dropped` with the decision. `built` entries are the next candidates for specs.

## Rework (WP-1020)
`npm run -s metrics:rework [-- --days N]` (default 7) prints, per landing day, how many work packages landed and their class: `new`, `fix`, `tooling`, `test` or `docs`, with count and share, and the lane split (`lead-c` for the WP-9xx and WP-10xx series, `product` for the rest). `-- --list <class> [--days N]` lists the work packages of a class with the rule that decided and the title. `npm run -s metrics` section 1 carries one row, "landed WPs (7 days): new x% · fix y% · ...".

The class comes from `scripts/metrics/rework.mjs`, in this order (the first rule that matches decides, and `--list` prints it): an explicit `kind:` in the frontmatter; owns only `docs/**` or READMEs (docs); a fix word in the title (fix, regression, flake, follow-up, red on main, ...); a hunt or follow-up origin in the Goal ("QA hunt", "privacy hunt", "follow-ups from"); the WP depends on a done WP and the Goal says something broke; the Goal names an earlier WP and says it fails; "tests for" or "e2e for" in the title (test); owns only specs (test); owns only tooling paths (`scripts/`, `bench/`, `.claude/`, `metrics/`, config files; tooling); lane `lead-c` (tooling); otherwise `new`. The land date is the `chore(wp): WP-x done` commit. It is a guess, not a verdict: set `kind:` where it is wrong. Audit 2026-10-04: see the log of WP-1020.

## Files
| File | Content |
|---|---|
| `scripts/metrics/report.mjs` | Builds the report |
| `scripts/metrics/flow.mjs` | WP events (`work/events/` plus the pending ones in `<git common dir>/land-pending`) and git history |
| `scripts/metrics/claude-usage.mjs` | Claude Code transcripts (`~/.claude/projects/<repo>*`), deduplicated per API response |
| `scripts/metrics/test-record.mjs` | vitest with the JSON reporter, into `tests.jsonl` |
| `scripts/ops/steps.mjs` | Runs the steps of the `check`, `check:fast` and `lint` suites in order (the `typecheck` suite runs its steps in parallel after its `typecheck:gen` step, WP-981) and times each into `check-steps.jsonl` (nested suites record their `parent`) |
| `scripts/metrics/check-steps-rows.mjs` | The section 3 check-steps table |
| `scripts/ops/check-recorded.mjs` | Is there a green full check recorded for this commit's tree? |
| `scripts/metrics/parity.mjs` | `npm run -s parity [-- --missing]` (WP-1011): the parity percentages per step from `metrics/parity/elements.json`; see "Parity" above |
| `scripts/metrics/rework.mjs` | `npm run -s metrics:rework [-- --days N] [-- --list <class>]` (WP-1020): classes done work packages as new / fix / tooling / test / docs with the rule that decided; see "Rework" above |
| `scripts/metrics/selection.mjs` | `npm run -s metrics:selection [--hours N]` (default 24). Why scoped runs (agents' `check:changed`) ran what they ran: each `kind: "scoped"` row in `tests.jsonl` carries `selection: { all, reason, seeds }` (`reason` is the line that decided "every test", e.g. `trigger package-lock.json -> all tests`, or `related`; `unknown` when the plan was not handed over; older rows show as `unrecorded`). Prints scoped runs, blanket runs (count and share), agent-minutes in blanket runs against all scoped runs, and a table by reason (count, minutes, branches). `npm run metrics` carries one summary line. |
| `scripts/metrics/check-cost.mjs` | `npm run -s metrics:check-cost -- [--since <iso>] [--until <iso>]` (default: today). Per WP landed in the window: full checks and `check:changed` runs (wall time, and phase: before the first verdict, fix rounds, after PASS), plus the land-staging checks (branch `HEAD`) as their own line; totals: full checks per landed WP, full-check wall-hours, summed `gateWaitMs` (or a note that no record carries it). Baseline 2026-10-01 before WP-953: 65 WPs landed, 366 full checks (5.63 per WP), 22.7 h of full-check wall time. |
| `scripts/ops/fanout.mjs` | `npm run -s test:fanout` (WP-990): how many specs `vitest related` selects per source file (top 40 by fan-out, with churn on `wp/*` merges of the last 7 days and cost = fan-out x churn). `-- --files a.ts b.ts` or `-- --branch <sha>` predicts what `check:changed` would run (blanket triggers and reader specs included); `-- --replay <n> [--since <iso>]` replays recorded `scoped` runs of `tests.jsonl` as JSON, per option (a: ui subpaths, b: barrel-aware, c: b + `import type`, d: c + additive barrels). Builds the graph from file text in about 0.7 s. Findings: `docs/research/test-fanout.md`. |
| `scripts/hook-post-edit.mjs` | Also logs each guardrail block into `guardrails.jsonl` |
| `scripts/docsync/*` | docsync logs into `docsync.jsonl` |
| `scripts/logwatch/*` | logwatch digests and tuning into `logwatch.jsonl` |
| `scripts/e2e-triage/*` | e2e failure classification into `e2e.jsonl` and `metrics/raw/e2e/` |
| `scripts/metrics/e2e-rows.mjs` | The section 8 cells |
| `scripts/metrics/wait-rows.mjs` | The two waiting rows under section 8 (e2e runs, land latency; WP-1023). `scripts/e2e/run-record.mjs` writes the `e2e-runs.jsonl` rows: `at`, `branch`, `sha`, `mode` (full, affected, filter, main-watch), `suites`, `shards`, `specs`, `wallMs`, `gateWaitMs`, `exitCode`, `failed`, `quarantinedRed`, `infra` (non-zero exit with no failing spec beyond the quarantined ones), `caller` (train under the land slot, else agent). Written once per run, to the main checkout, also on a crash or Ctrl-C. Land latency counts only WPs with a review PASS; the refused share counts `refused …` lines between that PASS and the merge. |
| `scripts/ui/journeys*` | journey runs into `journeys.jsonl` and `metrics/raw/journeys/` |
| `scripts/metrics/journeys-rows.mjs` | The section 9 cells |
