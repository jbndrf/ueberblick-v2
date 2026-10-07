# logwatch: the local model reads the logs, Claude reads only alarms

Reading logs all the time would burn Claude tokens. So the **local model (Qwen) reads the logs**, and Claude only sees what matters:

- **Hourly** (`logwatch.timer`): deterministic collectors gather system facts (memory, swap, pressure, disk, top processes), the user journal and kernel warnings, test runs, docsync and guardrail events, and extra log files (`LOGWATCH_FILES`, for example the app server later). Everything is redacted, deduplicated (`N× line`) and capped at about 15k tokens. The local model then classifies it as `ok`, `attention` or `alarm`, and lists issues. Thinking is off, so a run takes a few seconds.
- **Hard alarms never depend on the model:**
  - available memory < 10%
  - swap > 50% used **and** memory short (available < 25% or memory PSI some avg60 > 1); idle swapped pages alone do not alarm; the "memory short" rule is shared with `npm run housekeep` (`scripts/ops/memory.mjs`)
  - memory pressure
  - disk > 80% (`npm run housekeep` starts cleaning at 75%, see `lead-loop.md` step 1) (`housekeep` candidate kinds `cache`, `copy` and `vitest-cache` free the Node compile cache and real `node_modules` copies)
  - OOM or heap exhaustion in the logs
  - red `main` (only `main@` rows; land-train staging rows are labelled `train@` and a red one is normal), or 3 red train checks in a row (queue stuck)
  - a test run using > 70% of RAM
  - blanket test runs: over the last hour, scoped runs (`check:changed`) that ran every test are > 20% of the scoped runs or > 30 agent-minutes; the alarm names the top reason (`blanketAlarms` in `scripts/logwatch/sources.mjs`, `npm run -s metrics:selection --hours 1`)
- **Silent reds reach it too (WP-1015).** Every `silent red` line of `tests.jsonl` (a red run with no failed test, WP-1013) is written as its own `attention` entry, whatever the model said (`attentionEntries` in `scripts/logwatch/sources.mjs`). Not when the model is skipped for a busy GPU and there are no hard alarms: the run is deferred and the window re-read next hour.
- **Alarms and high-severity issues** are appended to `metrics/raw/ATTENTION.md`. That file is the lead's only log input (see the loop in `lead-loop.md`). Full reports stay in `metrics/raw/logwatch/`, read only on demand. The entry is written by the shared `attention()` in `scripts/metrics/lib.mjs`, the same writer e2e triage and the e2e-on-main watcher (`e2e.md`) use.
- **Weekly** (or `npm run logwatch:tune`): the local model (thinking off; with it the 27B used its 15k-token budget without answering) gets the machine facts, the configs and the last 50 measured test runs. It writes **tuning proposals** to `metrics/raw/logwatch/tune-<date>.md`. **Nothing is applied automatically.** The metrics report counts the proposals. The strategist reads the latest tune report at a course check when it contains high-impact proposals. The lead turns accepted ones into a work package. System-level changes, such as swap, earlyoom or sudo, are the owner's.
- It never reviews application code.
- It is a good GPU citizen: when another model is loaded, it defers to the next hour. With hard alarms, it still writes ATTENTION.md, without the model.

## Resource rules for tests and builds (enforced in code)
- Up to 6 work packages run `npm run check` at once. `scripts/ops/resources.mjs` gives each run a **fair share**:
  - workers = min(cores ÷ concurrent runs, 70% of available memory ÷ concurrent runs ÷ the measured MB per worker, 512 to 1024, default 1024; WP-986)
  - on this server (64 cores, 61 GB) that is about 41 workers alone, or 6 each with 6 runs
  - a run can carry a **weight** (`UEB_RUN_WEIGHT`, default 1; the land train's check sets 3): its share is weight ÷ total weight of all running runs, for cores and memory alike (WP-967)
  - override with `CHECK_MAX_WORKERS`
- Tests run in **forks** with a **2 GB heap cap per worker**, so a runaway test fails instead of taking the server into OOM.
- ESLint lints single-threaded (`--concurrency=off`) with a content cache; Prettier checks with a content cache, and vitest keeps transformed modules (`node_modules/.cache/vitest-modules/<lockfile hash>`, WP-932). All caches live in the worktree's `node_modules/.cache/` (WP-931: under load ESLint's worker pool cost more than it saved, and a warm cache skips unchanged files).
- Every test run records workers, concurrent runs, peak RSS of the whole process tree and CPU use (`tests.jsonl`, and section 3 of `npm run metrics`). Tuning decisions come from these numbers, not from guesses.

## Commands
| Command | Does |
|---|---|
| `npm run logwatch` | One digest now (normally the timer runs it) |
| `npm run logwatch -- --since-hours 24` | Digest over a longer window |
| `npm run logwatch:tune` | Tuning proposals now |
| `journalctl --user -u logwatch` | The timer's own log |

## Owner recommendations (system level, not automated)
- The server has only 1 GB of swap and no userspace OOM killer. `earlyoom` (or systemd-oomd) kills the biggest process before the kernel freezes the machine. Recommended: `sudo apt install earlyoom`.
- `sudo loginctl enable-linger jan` keeps the user services (docsync, logwatch) running without a login session.
- `sudo usermod -aG systemd-journal jan` lets logwatch read kernel messages (OOM kills).

Server log content is governed by `docs/process/logging.md` (no values, actor ids only, truncated IPs, retention).

A local-model error (for example llama-swap's HTTP 500 while a model loads) does not stop the run: the digest file says `model error: …`, the tuning pass is skipped, and the hard alarms still reach `ATTENTION.md` (`digestVerdict` in `scripts/logwatch/sources.mjs`, 2026-10-03).
