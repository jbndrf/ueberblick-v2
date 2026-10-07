# Running e2e (`npm run e2e`)

`scripts/e2e/run.mjs` builds apps/web once, then runs each suite in `SUITES` (`apps/web`, `e2e/a11y`, `e2e/participant`, `e2e/journeys`) and every discovered component suite (below) through Playwright.

## Parallel-safe (WP-925)

Several runs, in several worktrees, can run at the same time. Per run the runner

- asks the OS for free ports (`freePorts`), one per server a suite may start, all distinct,
- creates a private data directory per server under a scoped tmp dir (`scopedTmp`), and removes them at the end, pass or fail,
- hands both to each suite through env vars: `E2E_PORT` / `E2E_DATA_DIR` (apps/web), `E2E_A11Y_PORT` / `E2E_A11Y_DATA_DIR`, `E2E_PARTICIPANT_PORT` / `E2E_PARTICIPANT_DATA_DIR`. The names have no `UEB_` prefix because `specEnv` strips that.

A port is free when chosen but not reserved until Playwright binds it; a collision with another process is possible but very unlikely, and a rerun fixes it.

Each playwright config reads those vars and exports the resolved `E2E_PORT`, `A11Y_PORT`, `PARTICIPANT_PORT` and `*_DATA_DIR`, which specs import. A config wipes only its own data dir.

Without the vars (a direct `npx playwright test -c <config>`) the configs fall back to the ports 4173, 4174, 4175 and fixed dirs `ueberblick-e2e-{flow,a11y,participant}` in the OS tmp dir. That is **single-run only**: two direct runs collide. Use `npm run e2e` when others may be running. `reuseExistingServer` is false everywhere.

The e2e server gets adapter-node's `ORIGIN` from `PUBLIC_URL` through `originEnv` (`scripts/tls/origin.mjs`, WP-954); never set `ORIGIN` by hand.
A spec that needs the server's origin imports `E2E_PORT` from the config; never hard-code a port.

## E2E slots (WP-1016)

`npm run e2e` waits for one of K e2e slots before it builds, and holds it for the whole run: it re-runs itself through `scripts/ops/check-gate.sh --e2e` (a third pool next to full and light, first come first served; slot files `eslot.<n>`, tickets `eq.<n>`). Unrelated worktrees running e2e at once oversubscribed the CPU (24 Chromium processes, test p90 120 s → 186 s). K = `UEB_E2E_SLOTS`, else the number in `<git common dir>/check-slots/K.e2e` (one setting for every worktree), else 2. `0` is rejected; there is no bypass. A run inside a held slot (an e2e slot, a full slot or the land slot) does not queue again. The wait is printed (`waiting for a e2e slot (n running), queue position p`) and exported as `UEB_GATE_WAIT_MS`.

**Disk guard (WP-1024).** Parallel runs fill the disk (build output, browsers, Playwright's transform cache `<tmpdir>/playwright-transform-cache-<uid>`; on 2026-10-04 an agent got ENOSPC with 8.7 GB free). While free space on the filesystem of `$TMPDIR` (else `/tmp`) is under `UEB_E2E_MIN_FREE_GB` (default 10; raised from 6 on 2026-10-04, when ENOSPC hit e2e runs and a land train at about 8 GB free) the effective K is 1 and the gate prints `disk guard: N GB free (under 10 GB), e2e slots lowered to 1` once. Under half of it (5 GB) the gate starts nothing and prints `waiting for disk: N GB free`, re-checking on its poll. The full and light pools are unaffected. `UEB_E2E_FREE_GB` replaces the free-space probe (specs only). `npm run housekeep` prunes transform-cache files idle over 6 h (kind `pwcache`).

## Servers die with the run (WP-1030)
`scripts/e2e/run.mjs` installs a reaper (`server-reap.mjs`) before it starts anything. On SIGINT, SIGTERM, SIGHUP it sends SIGTERM to every process below the runner (npx, Playwright, the app servers, found by parent pid so Playwright's own process groups are covered), SIGKILLs what is still alive after 5 s and exits with 128 + the signal. On a normal exit it SIGKILLs leftovers. The node servers ignore SIGTERM, so the SIGKILL step matters. A runner that is itself SIGKILLed cannot clean up: `npm run housekeep -- --apply` reaps those orphans (parent 1, checkout gone, `lead-loop.md` step 1). The runner never blocks in `spawnSync` around Playwright, which would hold back the signal handlers.

## Parallel shards (WP-1009)

Each suite runs as `k` Playwright processes at once, `playwright test --shard=i/k` (`scripts/e2e/shards.mjs`). **A shard is one worker with its own server**: its own port and data dir (assigned like above, one copy of the suite's `PORT_VARS` per shard), so a spec never shares a server, an account, a participant's credentials, the login throttle or the seeded world with a spec of another shard. Inside a shard Playwright keeps `workers: 1` and `fullyParallel: false`, so the files of a shard and the tests of a file stay serial and in order. Playwright puts a whole file into one shard.

- **Count:** `UEB_E2E_WORKERS` (or `E2E_WORKERS`), default `min(4, cores / 8)` (4 on 32 cores or more), at least 1. `npm run e2e` prints the number it uses.
- **Debugging:** `UEB_E2E_WORKERS=1 npm run e2e -- --suite apps-web -g "<title>"` runs one plain Playwright process on one server, the way a spec runs when you write it. Use it first when a spec is red in a parallel run: if it is green alone, it shares state (see `docs/process/flakes.md`).
- **A file filter runs plain:** `npm run e2e -- --suite apps-web participant/x.spec.ts` runs one plain process, not shards. Shards pass their own file lists as positional patterns, and Playwright ORs positional patterns, so a sharded run would have run the whole suite (fixed 2026-10-04, found by lead-b). `-g` filters still shard. Without `--suite`, a file filter goes to every suite: suites with no matching file run with `--pass-with-no-tests`, so they do not fail with "No tests found", and the run fails (`no test matched the file filter`) only when no suite ran a test, so a mistyped path never passes (`fileFilter` in `scripts/e2e/affected-plan.mjs`, 2026-10-05, found by lead-b).
- **Do not raise Playwright's `--workers` on one server.** Measured (WP-1009): two or four workers on one server made specs red that pass alone (several specs share one participant and its one-time QR credentials; `seedWorld` checks, then creates, so two workers both create the world).
- **Port taken:** a port is free when the runner picks it, not reserved. A shard (or component suite) that fails with "already used" / `EADDRINUSE` is run once more with fresh ports and data dir (`spawnWithRetry`); other failures are never retried.
- **Reports:** every shard writes its own JSON report (`PLAYWRIGHT_JSON_OUTPUT_NAME`, `--reporter=list,json`); the runner merges them into the suite's usual report path (`SUITES[].report`), so triage and `e2e:main` read the same files. The log lines are prefixed `[shard n]`.
- **Balanced by recorded duration (WP-1016):** the runner lists a suite's files (`playwright test --list`) and deals them to the shards greedily, longest first, by the per-file durations of earlier runs (`balanceShards`, `scripts/e2e/shards.mjs`). The history is one JSON file per suite in `<git common dir>/e2e-durations/` (every worktree shares it; a run without `-g`/file arguments updates it). A file with no history weighs the mean file; with no history at all every file weighs its test count. A suite that cannot be listed falls back to Playwright's `--shard` split by count and says so.
- A spec that needs a scratch dir outside its data dir makes one per run (`rss.spec.ts` uses `mkdtempSync` and removes it); never a fixed path, worktrees and runs would collide.
- **Component suites shard too (WP-1016).** Every suite, fixed or component, runs as up to `k` shards, and the shard processes of all suites share one pool of `k` (`createLimiter`): a suite does not wait for the one before it. Component configs take their port from the derived env (`componentRun(id, fallbackPort)` in `scripts/e2e/component-config.mjs`) and write `outputDir` under their per-run data dir, so shards and suites share neither a port nor a `test-results` dir. The web-backed harnesses compile the participant message catalogue once before the pool (`UEB_E2E_PARAGLIDE_DONE=1`, `paraglideStep()`): compiles in parallel rewrite the same files. Every harness `vite.config.ts` sets `cacheDir: harnessCacheDir(import.meta.url)` (WP-1040): its own Vite dependency cache: inside a runner copy (every shard has its own `E2E_COMP_<id>_DATA_DIR`) `<that dir>/vite-cache`, so shards of one suite and two runs at once never share one (a shared one left a shard answering `504 Outdated Optimize Dep` until every test timed out); a run by hand uses `node_modules/.vite-e2e/<harness path>`. A shared cache lets harnesses that re-optimize at the same moment rewrite each other's deps, so the page reloads mid-test; a guard spec fails a harness without it. `RUN_ALONE` in `run.mjs` is the named allowlist (`id -> reason`) of suites that stay flaky beside others and run plain after the pool; it is empty unless a measurement put one there.
- A `--shard` or `--workers` you pass through yourself is on you.

## v3 journeys

Every journey runs twice, in the Playwright projects `phone` (Pixel 7, below 768 px, touch) and `desktop` (1280x800); `--project phone` or `--project desktop` selects one (WP-950). Both come from `phoneAndDesktop()` (`scripts/e2e/component-config.mjs`), the one device definition the UI e2e suites use (R1).

`e2e/journeys` is the suite for the v3 journeys (`docs/process/v3-journeys.md`). Run it alone with `npm run e2e:journeys`, which is `npm run e2e -- --suite journeys`. `--suite <id>` takes `apps-web`, `a11y`, `participant`, `journeys`, `comp:<id>` or `components` (all component suites) and may repeat; without it every suite runs. Other arguments (for example `--project`, `-g`) pass through to Playwright for each selected suite.

## Build reuse and flavour (WP-1029)

`npm run e2e` no longer builds unconditionally: `prepareBuild` (`scripts/ops/web-build.mjs`, called by `scripts/e2e/run.mjs`) calls `isStale(root, { flavour: 'probe' })` and prints `e2e: web build is current (probe), reused`, or `e2e: building the web app (probe) …` and builds through `ensureBuilt({ flavour: 'probe' })` (same lock as `demo` and `journeys`). A build has a flavour, written to `apps/web/build/.flavour` by every build through `web-build.mjs`: `probe` (`UB_MAP_PROBE=1`, the e2e map read-back seam) or `plain`. With a flavour asked for, a missing or different marker is stale; `isStale()`/`ensureBuilt()` without one (`demo`, `ui`) accept any build. Freshness also covers `messages/` and `project.inlang/` of `apps/web` and every package it ships (and `packages/builder` and `packages/tools/*` sources). A rebuild by hand (`npm run build -w @ueberblick/web`) empties `build/`, so the marker goes with it and the next e2e run rebuilds.

## Stale build and kills by pattern (WP-947)

`scripts/ops/web-build.mjs` checks the web build for staleness (mtime of `apps/web/build/index.js` against the sources it depends on). `demo`, `ui seed` and `journeys` rebuild when stale (one build at a time, lock file); `demo.spec` and `ui.spec` skip with the build command in the message instead of building inside `npm run check`.
The land train builds the web app (probe flavour since WP-1029, so the affected e2e right after reuses it) before its check when the merged diff touches `apps/web/**` or `packages/**`, so these specs run there (WP-962, `docs/process/orchestration.md`). Specs that start a server stop it in `afterEach`/`afterAll` by pid (`scripts/demo/teardown.mjs`: SIGINT, SIGKILL after a grace period, wait for the port), so one red case does not become several `EADDRINUSE` reds.
Kills by pattern (`pkill -f`, `killall`, `kill $(pgrep -f ...)`) are blocked by the `PreToolUse` hook `scripts/hook-pre-bash.mjs`; kill by pid (`lsof -ti :<port>`, pid file).

## Two devices of one project (WP-944)

`e2e/participant/two-devices.ts` is the harness for journeys where one device's change must show on another (live collaboration, `docs/07-sync-and-offline.md`).

- `openDevice(browser, baseURL)` makes a fresh browser context (own IndexedDB and session), signs in with a new QR token and waits for the app shell. Open two to get two devices; close both contexts in a `finally`.
- `openTreeSheet(page)` opens the seeded tree's feature sheet through the list, which survives the shell port (no view chips). `submitFinding(page, text)` runs "Add finding".
- `latencyUntil(check, limitMs)` returns the milliseconds until `check` holds. Specs print `LATENCY <case> <ms>`.
- Go offline per device with `context.setOffline(true)`; the other device stays online.
- Use unique text per run (the task rejects an unchanged finding) and assert absence while a device is offline, so the pass is not vacuous.

`e2e/participant/live-sync.spec.ts` covers both devices online (change shows within 5 s) and a device returning online. Run alone: `npx playwright test -c e2e/participant/playwright.config.ts live-sync --repeat-each 3` after `npm run build -w @ueberblick/web`.

**Repeat cap (WP-1035):** `npm run e2e` refuses `--repeat-each N` (or `=N`) with N over 10 (exit 64: "e2e: --repeat-each N is over 10; a repeat run holds a shared e2e slot. Ask your lead, then rerun with UEB_E2E_REPEAT_OK=1"), because a long flake hunt holds a shared e2e slot while others wait. The lead decides; `UEB_E2E_REPEAT_OK=1` lets it through. The land train never passes `--repeat-each`.

## Component suites (WP-951)

A UI component port brings its own Playwright config and needs no tooling change. `allSuites(root)` (`scripts/e2e/run.mjs`) is the fixed `SUITES` plus every `<workspace>/src/**/e2e/playwright.config.ts` (the workspaces of the root `package.json`: `packages/*`, `packages/tools/*`, `apps/*`) found by `discoverSuites` (`scripts/e2e/discover.mjs`). Triage reads the same list.

- **Id:** `comp:<workspace dir without packages/ or apps/, slashes as dashes>/<path from src to the e2e dir, slashes as dashes>`, e.g. `packages/ui/src/components/mobile-select/e2e/playwright.config.ts` is `comp:ui/components-mobile-select`, and `apps/web/src/lib/participant/feature/activity/e2e/…` is `comp:web/lib-participant-feature-activity`, and `packages/tools/file/src/e2e/…` (directly under `src`) is `comp:tools-file`. Run one with `npm run e2e -- --suite comp:ui/components-mobile-select`, all with `--suite components`.
- **Report:** the config writes a JSON report to `apps/web/test-results/e2e-comp-<package>-<path>-report.json` (id with `:` and `/` as `-`).
- **Port and data dir:** one server per suite. The env names derive from the id, uppercased with other characters as `_`: `E2E_COMP_UI_COMPONENTS_MOBILE_SELECT_PORT` and `E2E_COMP_UI_COMPONENTS_MOBILE_SELECT_DATA_DIR`. `portEnvFor(id)` in `discover.mjs` returns the pair; the config reads them through `componentRun(id, fallbackPort)` (a fixed fallback port for direct single runs); no config reads its own env var.
- **Devices:** the config sets `projects: phoneAndDesktop()` from `scripts/e2e/component-config.mjs`: `phone` (Pixel 7, touch, below 768 px) and `desktop` (Desktop Chrome 1280x800). A port is done when its specs pass in both.
- A config that fails to load makes Playwright exit non-zero and the run fails naming the suite; nothing is skipped.

## Affected e2e on the land train (WP-1019)

After the full check is green, the train runs `npm run e2e -- --affected <base>` (`<base>` is main before the train's merges) in the staging worktree (`scripts/orchestrate/land-train.sh`, `affected_e2e`). **Agents don't run it (owner, 2026-10-04):** implementers and reviewers run only the e2e spec files their work package added or changed (`npm run e2e -- --suite <id> <file>…`); agents waited about 10–17 min per WP on a broad affected run that the train repeats anyway. Leads may run it by hand the same way against any commit: `npm run e2e -- --affected main` selects for your branch's changes (it diffs the working tree against the merge-base with main). Not `--affected HEAD`: that diffs against your own last commit and sees only uncommitted changes, so it selects nothing on a committed branch. A red spec refuses the train like a red check (step `e2e`, exit 3) and the train is bisected, **with only the failing specs** (WP-1027): the halves run `npm run e2e -- --suite <id> <file>…` for the files named in `e2e: failed suites:`, not the check and not the affected selection; the innocents then get one full attempt. An infrastructure failure bisects in full. The selection, the specs skipped for budget and stale quarantine entries are in the land output.

**Switched off (owner, 2026-10-04, build first).** While the file `<git common dir>/train-e2e-off` exists (`.git/train-e2e-off` in the main checkout), the train skips this step and the land output says `e2e: skipped, train e2e is off`. e2e then runs on main (`e2e:main`), and its reds become fix WPs in the owning lane. Delete the file to switch the step back on; no land is needed.

**Selection** (`scripts/e2e/affected.mjs`; tested by `scripts/e2e/affected.spec.ts`). It reuses the import graph of `check:changed` (`scripts/ops/fanout-graph.mjs`, one resolver). e2e specs drive the built app, so a changed file reaches a spec in two ways:

- the spec's own import closure (helpers, seeds, packages) reaches the file, or the spec changed itself;
- an app file (anything under `apps/web/src`, `packages/*/src`, the message catalogues) reaches a route (its `+page`, `+server`, the `+layout` files above it) and the spec visits that route. A spec visits a route when a string literal path in the spec or its e2e helpers names it (`goto('/admin/projects/${key}/data')`, `'/api/p/'` as a prefix; a path five or more segments deep also covers the pages below it, because a spec that opens a feature clicks on from there) or the spec has a line `// e2e-covers: /admin/projects/[key]/data, /map`. A path that more than half of a suite's specs reach only through helpers (the sign-in page) does not count.
- Changes that reach only the shared code every route loads (`hooks.server.ts`, the root layout), and changes in the engine packages (`packages/core`, `packages/server`, `packages/client`: unit-tested logic that every route loads), run one smoke spec per suite, the fastest by history, plus the specs that import the changed file themselves. Without this rule a core change selects every route. A spec that names no route runs on any app change.
- A suite's `playwright.config.ts` or its `support/` dir selects the whole suite. A component suite runs whole when its harness reaches the change. A lockfile, a package.json change outside `scripts`/`description`, vite/svelte config, `static/`, css or another asset the graph cannot follow, and a deleted app file with no base graph select every route. A change to `scripts/e2e/{run,shards,component-config,discover}.mjs` selects every fixed suite. Everything else (docs, other scripts, work packages) selects nothing.

The limit: a spec that reaches a page only by clicking through the UI is not seen. Give it an `e2e-covers:` line.

**Budget.** The estimate is the recorded duration of the selected specs (the per-file history above; a file with no history weighs the suite's mean) divided by the shard count. Above 10 minutes the train runs the slowest-first subset that fits and prints `e2e affected: WARNING over the 10 min budget: SKIPPED n item(s): ...` with every skipped spec; it is copied into each landed branch's land output. Nothing is skipped silently.

**Quarantine** (`scripts/e2e/quarantine.json`, checked by `affected-quarantine.mjs`). Specs that are red on main at workers=1 do not refuse a train. Each entry: `suite`, `file` (repo-relative), `line` (the `test(` line Playwright reports), `lane` (`lead-a`, `lead-b`, `lead-c`: who fixes it), `since` (date) and a `note`. An entry without a lane or date fails the run. A red test not in the list refuses the train. The list only shrinks: when a quarantined spec runs green, or its file is gone, the run prints `STALE quarantine entry`, and the lane deletes the entry in the commit that fixes the spec.

**A main red does not block trains (WP-1033), but it still needs an entry.** When a train's e2e is red only in specs that are also red on the train's base main, the train lands with a note and `metrics/raw/ATTENTION.md` gets a `main e2e red:` line (see `docs/process/orchestration.md`). That is a stop-gap: the lane named in the file still adds the quarantine entry above and fixes the spec.

**Replay.** `node scripts/e2e/affected-replay.mjs 10` replays the selection for the last 10 land trains (their first merge's parent to their last merge) and prints the counts and the estimated minutes.

## Every run is recorded (WP-1023)

`npm run e2e` appends one row per run to `metrics/raw/e2e-runs.jsonl` in the main checkout (also when run from a worktree): mode (full, affected, filter), caller (train under the land slot, else agent), suites, shards, specs, wall time, gate wait, exit code, failed and quarantined-red counts, and `infra` for a non-zero exit with no failing spec. A crash or Ctrl-C still writes its row (`scripts/e2e/run-record.mjs`; fields in `docs/process/metrics.md`). `npm run -s metrics` shows the last 24 h under "Waiting" next to land latency. The `main-watch` mode is set when `UEB_E2E_CALLER=main-watch` is in the environment; `e2e:main` does not set it yet, so its runs show as full/agent.

## e2e on main every 5 hours (WP-978)

The land train runs only the e2e specs its changes can affect (below), so most reds are caught before main; the full suite is not part of the gate, and `npm run e2e:main` (`scripts/e2e/main-watch.mjs`) is the watcher that finds a red that slipped through.

- **Worktree:** a detached `<main checkout>-e2e` (outside `.claude/worktrees`), created once and reset to main's tip each run. `node_modules` are hardlinked from main (`ensureNodeModules`; never `npm ci`: a lockfile mismatch stops the run with an `e2e:main could not run` alarm). `apps/web/build` is reused; `apps/web/test-results` and `playwright-report` are removed at the start of each run, so artifacts never accumulate.
- **Skips (logged, no row):** main has not moved since the last main-watch row, or the 1-minute load is above the core count.
- **Load:** `npm run e2e` runs under `nice -n 10` (and the service has `Nice=10`). It does not take a check-gate slot: the light pool is for short bursts, and a multi-minute run would hold one.
- **Row:** one line in `metrics/raw/e2e.jsonl` with `kind: "main-watch"`, `sha`, `suites` (id, name, passed, failed, failing), `passed`, `failed`, `failing` (`<suite>:<file>:<line>:<title>` and the first error line), `exit` and `ms`. A suite without a report counts as one failure, `<suite>:(no report)`. The metrics report shows the last run apart from triage's rows.
- **Alarm:** reds that the previous main-watch row did not have are written by the shared `attention()` to `metrics/raw/ATTENTION.md` (sha, at most 10 specs with their first error line). Known reds are not repeated; a fixed red leaves the baseline, so it alarms again if it returns.
- **Details (WP-1044):** a run with a red also writes the full error of every failing test (message up to 80 lines, location, stdout and stderr tails, attempts, trace and screenshot paths) to `metrics/raw/e2e/main-<UTC>-<sha7>.md` before the worktree is reset; the row's `details` field and the ATTENTION entry name that file. Green runs write none; files older than 14 days are deleted.
- **Exit code:** 0 even on red. It is a watcher, not a gate.

Install the timer (the lead does this once, after the land):

```bash
cp scripts/e2e/e2e-main.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now e2e-main.timer
journalctl --user -u e2e-main   # the run's log
```

It fires every 5 hours at minute 17 (`OnCalendar=*-*-* 00/5:17:00`: 00:17, 05:17, 10:17, 15:17, 20:17, up to 5 minutes of random delay; owner 2026-10-04). Run it by hand with `npm run e2e:main`.

The participant journeys (`apps/web/e2e/participant/journeys.spec.ts`, WP-703) and their server-state helpers in `world.ts` are described in `docs/process/testing.md`.

## Guards on the e2e specs (WP-1017)

- **Both sizes.** Every participant e2e (`apps/web/e2e/participant/**/*.spec.ts` and the component e2e under `apps/web/src/lib/participant/**/e2e/`) runs at a phone and at a desktop viewport: a table or loop of `'phone'` and `'desktop'`, `devices[...]` presets or `viewport` widths (below 768 is a phone), or, for components, `projects: phoneAndDesktop()` in the config next to them. `scripts/ops/e2e-viewports.spec.ts` fails on a spec with one size. A spec that must stay single-size has an entry with a reason in `scripts/ops/e2e-viewports.allow.json` (`TODO(<lane>): add <size>` while the second size is owed, or why the spec does not depend on size). A stale entry (the file is gone or now covers both sizes) or one without a reason fails too.
- **One axe helper (WP-1042).** Every e2e spec scans with `e2e/a11y/axe.ts` (`axeViolations(page, { scope?, rules?, tags? })`, or `runAxe` for the full result) and never injects axe-core itself. The helper injects axe once per page, waits until the page's finite animations have finished (at most 2 s, then `runAxe` returns `settled: false`), and scans. Without the wait, a dialog's 200 ms fade-in is scanned at partial opacity and reports a colour-contrast failure that is not real. `scripts/e2e/axe-guard.spec.ts` fails any e2e file that references `axe-core` or `window.axe` outside the helper; the wait itself is tested in `apps/web/e2e/axe-helper.spec.ts`.
- **Project keys.** `scripts/ops/e2e-project-keys.spec.ts` fails when two e2e files create the same project key. It also reads keys created inside `test.extend` fixture bodies (worker-scoped ones too) and through helpers named `...createProject(key)`; keys built at runtime are not seen. The same spec fails when two files create the same literal (or `const`) admin e-mail through `createAdmin(...)` or `admin(['create-admin', …])`: a shard's specs share one data dir and `create-admin` refuses an existing e-mail. Use `uniqueEmail(prefix)` from `apps/web/e2e/admin/sign-in.ts` for new accounts.
