# e2e triage

After a red `npm run e2e`, run `npm run e2e:triage`. The local model (Qwen) classifies each failure, so no Claude tokens go into traces and screenshots. The spec is part B of `journeys.md`.

## Usage
```bash
npm run e2e                                  # runs every suite (fixed SUITES plus discovered component suites; scripts/e2e/run.mjs), one JSON report each
npm run e2e:triage                           # classify every failing test of every suite's report
npm run e2e:triage -- --report <path>        # one report only (suite shown as "(custom)")
```

Each suite in `SUITES` declares its `report` path (all four write under `apps/web/test-results/`); its Playwright config writes the JSON there and keeps a trace and a screenshot of every failure (`retain-on-failure`, `only-on-failure`). A discovered component suite's report is `apps/web/test-results/e2e-comp-<package>-<path>-report.json` with the id's `:` and `/` as `-` (`discover.mjs`, `docs/process/e2e.md`). Triage reads the same list, `reportTargets(allSuites(ROOT))` from `scripts/e2e/discover.mjs`, so a component suite needs no change here; a guard test checks that each config writes its declared report. `apps/web` ignores `e2e/candidates/**`: journey candidates only run once adopted.

## What it does
- For each failing test it collects spec and line, title, failing step, error, console and network errors, a text summary of the trace (last 40 actions, console errors, failed requests, the last DOM snapshot, trimmed) and the last screenshot (sent as an image). The prompt text is capped at 20,000 characters.
- The model answers `{class, confidence, evidence, next}` as JSON. `class` is `app-bug`, `test-bug`, `flaky` or `env`; `confidence` is `high`, `medium` or `low`. Invalid JSON gets one retry, then the failure is `unknown`.
- Output: `metrics/raw/e2e/<stamp>.md` (failures grouped by suite, one section per failure) and one line in `metrics/raw/e2e.jsonl` (`{at, failures, byClass, bySuite, tokens: {in, out, image}, ms}`). `npm run metrics` shows them in section 8.
- Only `app-bug` with `confidence: high` is appended to `metrics/raw/ATTENTION.md`. Everything else is read on demand from the `.md`.

## Failure modes
Without the local model (unreachable, or another model holds the GPU for more than 2 minutes) the report is still written with `class: unknown` and the command exits 0. A suite whose report is missing is itself a finding (`class: env`, no model call, exit 0). Only a missing `--report` file is an error (exit 1). `npm run journeys -- --all` waits for the GPU with the same `waitForGpu`. `image` tokens are an estimate (one per 28x28 pixel patch); `in` already includes them.

Qwen never fixes anything: the lead turns an `app-bug` into a work package and a `test-bug` into a fix of the spec.
