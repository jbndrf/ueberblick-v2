# Final report: Überblick v4 autonomous build

Status: final, 2026-10-01 (lead-a, from lead-c's running draft). Every work package on main is `done`, and every roadmap item is done or listed under §5 "Needs owner". Main is at `e64d772e`, and a full `npm run check` on that tree is green (2026-10-01 03:35: 417 test files, 5608 tests passed, 59 skipped in the long profile; exit 0). The only later commit, `516cc8f2`, adds 6 roadmap lines. The owner demo runs on final main with every workaround removed (lead-c, WP-920/922). Built 2026-09-17 → 2026-10-01 by three Opus leads, Sonnet implementers and reviewers, and a local 27b for docs and review fixes.

## 1. What was built (per phase)
Source: [`docs/process/roadmap.md`](roadmap.md) (checkboxes synced to `npm run wp` by lead-c; it lists every phase through WP-600 and WP-554.3) and `npm run -s wp`.

| phase | state (2026-10-01 03:25) | open work packages |
|---|---|---|
| 0 specification | done | — |
| 1 core | done | — |
| 2 server | done; course check 004 follow-ups landed: WP-168 roster and QR credentials, 169 one `deployProject`, 170 one store composition, 171 value-move deploys refused (A-024), 172 converter emits an erasure task, 175 unknown participant fails closed (A-025) | — (WP-178/179 closed: no miss, see §2) |
| 3 device runtime | done | — |
| 4 participant app | done | — |
| 5 builder | done; new: WP-176 Participants lens, WP-177 QR image and counts, WP-180 admin sign-in | — |
| 6 migration | synthetic path done; the migration fills the roster (WP-168), and WP-172 closes the GDPR gap for migrated projects; pilot and cutover need the owner | WP-303 execution (needs-owner, §5) |
| 7 hardening | done | — |

**Phase 0, specification.** The spec in `docs/` (glossary, 13 foundations, data model, rule language, builder, budgets, UX principles, future capabilities), the golden corpus (`fixtures/golden`: templates, scenarios), and the work-package process. Course checks 001–004 kept it honest; the 42 later topics in §4 are where the spec was decided provisionally.

**Phase 1, core.** `packages/core`, pure TypeScript with no I/O (R2), running unchanged on device, server, builder simulator and tests: the project-file schema and template merge, the CEL-subset rule language (parser, checker, evaluator, SQL translation), geometry, permissions, `plan` → observations or a typed refusal, `fold` as the only definition of current state, the sync protocol and the registries. Measured: fold 60k 652 ms of 5000; incremental fold 0.009 ms per observation; plan with rules 0.23 ms of 5; compile 500 types 27 ms of 200; expression evaluation at 60k 94 ms of 100. Left open: the parser and key-path choices in A-002, A-003 and A-005, which are the costliest to change (§4).

**Phase 2, server.**
- **What exists.** One write path: `POST` runs, planned by core and committed in one SQLite transaction. One store composition (`composeProjectStore`, WP-170) serves runtime, migration and backup replay. Around it:
  - sync: snapshot and delta;
  - the OGC API Features read and write surface;
  - auth: admin accounts with TOTP, QR credentials for participants against a roster (WP-168), fail-closed for anyone outside it (A-025);
  - one `deployProject` that also rebuilds timers (WP-169), with breaking deploys that need value moves refused (A-024);
  - erasure as an ordinary `redact` run, which backup restore replays (A-021, A-022);
  - structured logs, and backup and restore scripts.
- **What was measured** (serial strict run): run p95 5–7 ms of 50; HTTP overhead under 1 ms of 5; 60k snapshot about 14 s of 20; empty delta about 3 ms of 10; derived-edge recompute 17 ms of 20; edge lookup 0.8 ms of 1.
- **What is left open on purpose:** OIDC (O10, Phase 7); who may erase (A-023, decide before the pilot); a value-move executor (A-024); browser TOTP enrolment (A-027).

**Phase 5, builder.**
- **What exists.** A project-file IDE with a breadcrumb (project > type > task), a lens switcher and an always-visible problems panel. The lenses are:
  - data model, process, task, roles and apps, views and map, rules (with a "why did this (not) fire" panel), simulate and YAML;
  - Versions: plan, deploy, history, rollback, upgrade wizard and template publish;
  - Participants: roster, roles, one-time QR login with a scannable code (WP-176, WP-177).
- **Supporting pieces:** admins sign in at `/builder/login` and pick a project from `/builder` (WP-180). Drafts save with compare-and-swap.
- **What was measured:** render budgets, e.g. roles 125 ms and data model 101 ms of 300. Lazy chunks keep CodeMirror and the QR encoder out of the entry chunk. Every lens reflows at 320 px (WCAG 1.4.10) and is axe-clean.
- **What is left open:** teams (O12); several named drafts per project (A-011); a separate template-publish role (A-013).

**Phase 6, migration.**
- **What exists.** `apps/migrate` converts a v3 project into one v4 project file. It marks personal data and adds an erasure task (WP-172), and imports the data as runs through the shared store composition. It fills the participant roster from v3 users (WP-168), prepares geometry with the server's own function (WP-150), and reports a diffcheck. The synthetic legacy exports and the golden corpus pass.
- **What was measured:** a 60k-feature export converts and folds to the expected state; the long profile runs it, and a 6k variant runs in every check (WP-936).
- **What is left open:** running it on real v3 data, the pilot on a copy, and the cutover. All need the owner (WP-303, §5).

**Phase 3, device runtime.**
- **What exists.** An IndexedDB store with chunked writes; a run queue with prediction, typed refusal, rebase and self-scheduled retry through the timers port (WP-578); a sync worker for snapshot, delta, doorbell and scope; the whole pipeline in a Web Worker (B-012); and simulation against the real adapters.
- **What was measured:** offline copy of 60k 25.1 s (≤ 30); longest main-thread task 0 ms on the worker host (≤ 100; 254 ms when it ran in-thread); empty delta p95 2.7 ms (≤ 10); delta visible after a run 11.4 ms (≤ 1 s, node); store-mirror heap 46.3 MB (≤ 60).
- **What is left open:** iOS storage eviction is guarded but not field-tested; there is no conflict UI beyond the typed refusal (queue export exists).

**Phase 4, participant app.**
- **What exists.** The role-profile shell; a map built from views (MapLibre 2D, cluster worker, list alternative, camera and fit); the feature sheet with display names (B-014); the task sheet; the photo, draw, measure and search tools; `$ref` styles embedded at ingestion (B-013); and an https-required notice.
- **What was measured** (×4 device factor unless noted): shell JS 96.6 KB gz (≤ 250); cold start to first markers 1.4 s and warm 1.2 s (≤ 5 / ≤ 3); cluster build 60k 968 ms warm and 1184 ms cold (≤ 1200 / ≤ 1500); cluster main-thread slices 56 and 64 ms (≤ 100); task sheet open with 50 fields about 160 ms (INP ≤ 200); viewport query 0.64 ms (node).
- **What is left open:** MapLibre init is a 110–170 ms long task under software GL, to be judged on a real GPU (B-007, §5); the Measure panel height on small phones; unreachable app-side `style_unresolved`/`tool_setting_invalid` code still to remove (B-013 follow-up); no in-app QR reader beyond the sign-in link; no teams or dispatch (H2, O12).

**Phase 7, hardening.**
- **What exists.** GDPR erasure as a run with redact and a guarded purge, per-subject purge (WP-582), `erasure_runs` replayed on restore (WP-536), subject export, the `personal_without_redact` compile warning and a logging privacy rule. Accessibility: axe checks, the BITV self-check and accessibility statement (de/en), and map zoom and position controls (WP-554.3), leaving 0 open fails in the self-check. Operations: a Litestream drill, OIDC, an SBOM and security.txt.
- **What is left open:** the WCAG level is provisional (B-011); a real assistive-technology user test and a legal review of the statements need the owner.

## 2. Benchmarks against `docs/12-performance-budgets.md`
Source: `npm run bench` → `metrics/raw/bench.jsonl`. The full table of all 100 budget lines (row, budget, measured, device factor, verdict) from the serial strict run is in the Log of `work/WP-921-bench-serial.md` and in `metrics/raw/bench/2026-09-30.json` (serial strict run, all 100 lines PASS). The latest value per line is in `npm run -s metrics` §6. One line there, `task-sheet-open-50-fields-total` 438 ms of 200, is a stale jsdom record: WP-549 removed that line in favour of the real-browser `task-sheet-50` row (about 160 ms at ×4, §1 phase 4), so it is not a live miss.

Run 2026-09-30 18:30 local (load 0.7/core, so over-budget lines are `UNRELIABLE`, not failures): 55 bench files, 88 of 89 pass. Over budget:
- builder-roles-render 327 ms vs 300 ms, builder-data-model-render 337 ms vs 300 ms (dev-only; WP-153, lead-a). Fixed since by WP-162: 153 ms and 123 to 169 ms at load 0.8 to 1.0 per core
- long-task 32.8 ms (×4: 131 ms) vs 100 ms
- search-tool keystroke 13.1 ms (×4: 52 ms) vs 50 ms

WP-913 routes all 38 raw wall-clock bench asserts through the load-aware harness verdict.

Strict run 2026-09-30 21:55 (`BENCH_STRICT=1 npm run bench -- --strict`, load 0.11–0.41 per core, main at 0d34a373): 55 bench files, 86 of 89 budget lines pass. The 18:30 suspects were load effects: long-task 11.6 ms (×4: 46 ms) of 100, search-tool keystroke 6.8 ms (×4: 27 ms) of 50, builder-roles-render 125 of 300, builder-data-model-render 101 of 300. Over budget, all `[server]` (phase 2, lead-a):
- server-derive-polygon-p95 28.1 ms vs 20 ms (+40%)
- server-facts-edges-p95 1.40 ms vs 1 ms (+40%)
- expr-sql-or-list-16k-60k 101.4 ms vs 100 ms (H6) and expr-sql-bbox-filter-60k 100.7 ms vs 100 ms (at the edge)
Correction (22:30): all four were a harness artifact. `npm run bench` ran all 55 bench files in parallel, so the benches measured each other. Rerun serially (`--no-file-parallelism`, strict, 0.12 load per core): server-derive-polygon-p95 16.95 ms, server-facts-edges-p95 0.825 ms, expr-sql-bbox-filter-60k 71.1 ms, expr-sql-or-list-16k-60k 66.4 ms, all within budget. lead-a doubted the number because WP-178 could not reproduce it. None of the lines was over budget. The work the misses started still paid off:
- WP-178 lands an independent golden edge-set test (a brute-force within/intersects check) plus its profile: COMMIT 40%, candidate read plus geo tests 43%, inserts 17%.
- WP-179 keeps migration 9's covering `edges_by_to` index, which removes a temp B-tree sort (edgesTo p99 1.27 → ~0.7 ms under load).
- WP-590 (with WP-591 for lookup.ts and ogc/items.ts) corrects the bbox query plan to drive by the R*Tree: about 24 and 55 ms in isolated strict runs.

WP-591 (lead-b, 9702a487) moves the server's bbox reads onto FROM clauses from core:
- `viewportFrom` drives by the R*Tree and serves `lookup.ts` `bboxQuery`/`near` and `Facts.near`.
- `viewportPageFrom` does a plain join with a rowid walk stopping at LIMIT and serves OGC items. A CROSS JOIN there made wide-viewport paging about 100× slower.
- A guard spec forbids hand-written `feature_bbox` joins in server code.

server-facts bbox at 60k with a config index, median ms, isolated strict runs:

| viewport | before | after |
|---|---|---|
| 1% | 59 | 1.0 |
| 10% | 70 | 10–11 (p95 15) |
| 100% | 145–152 | 139–149 |

OGC items paging is unchanged by design. Without a config index, all reads are unchanged. The lines are in `bench/server-facts/viewport-shapes.bench.ts`.

WP-921 makes the harness run files serially. The full serial strict run (2026-09-30 ~23:00, load 0.11–0.39 per core) took 320.8 s instead of 43 s. All 100 budget lines pass. search-tool and draw-bundle were rerun separately after generating their messages, and all 4 of their lines pass. The four former misses: server-derive-polygon-p95 16.06 ms (20), server-facts-edges-p95 0.817 ms (1), expr-sql-bbox-filter-60k 26.7 ms (100), expr-sql-or-list-16k-60k 49.7 ms (100); the expr-sql numbers include WP-590's plan fix.

## 3. Metrics
Source: `npm run -s metrics`, final run 2026-10-01 03:20 over the whole build window 2026-09-17 → 2026-10-01.

| metric | value |
|---|---|
| work packages merged | 276 (19.7 a day); cycle time p50 0.6 h, p90 3.0 h |
| commits on main | 1549, of which 60 are docsync merges |
| change failure rate | 18% (51 fix or revert commits) |
| red main | 20 times, recovery p50 0.0 h; none since 2026-09-30 20:25 (see the red-land lines below) |
| review rounds per WP | 1.5 on average, max 4; first-pass PASS 50%; escalated 8 |
| red lands (check, install, conflict) | 75; the reverts-only rate is in the red-land lines below |
| blocked time | 0.0 h recorded |
| tests | 5074 on the last recorded main run (the first record had 8); the final full check on `e64d772e` passed 5608 (59 skipped); test runs 1696, 15% red |
| suite wall time | p50 34.6 s, latest 61.0 s; full `check` p50 145 s, p90 178 s |
| Claude tokens | Sonnet 18,737 calls, 1.81 B input (97% cache hit), 3.02 M output; Opus 4,485 calls, 1.21 B input (99%), 2.26 M output; 19.2k output tokens per merged WP |
| by role | implementers 2.80 M output; leads 2.24 M; reviewers 221k; strategist 6.2k |
| local model (docsync) | 106 runs: 71 proposed, 21 no change, 14 guardrail-rejected; 8.8 M tokens in, 2.4 M out; p50 171 s per run; Opus outcomes 36 as-is, 24 edited, 10 rejected |
| local model (review-FAIL fixes) | 23 rounds, all committed, no fallback to Sonnet; 21 of 23 passed at the first re-review (Sonnet warm-fix baseline 67 of 93, 72%); fix time p50 596 s (Sonnet baseline ~470 s) |
| docsync probation (C-001) | 19 of 20 branches since 2026-09-30 17:56Z: 13 as-is, 4 edited, 2 rejected (32%, stop line 50%), so docsync stays |

Flaky candidates the metrics flag, which aren't in flakes.md yet: `scripts/sbom.spec.mjs` › "npm run sbom output validates…" (4 runs on 4 branches), and `packages/core/src/expr/check/check.spec.ts` › "every declared property resolves…" (1).


Red lands: 44 of 427 lands reverted up to 2026-09-30 16:30 (10.3%). Causes and status: `docs/process/flakes.md`.
After WP-903 (red lands refused in staging, main never touched): 16:15–19:40 12.5% (80 attempts), 19:40–21:20 5.9% (68, 3 of 4 from one spec env leak), 20:25–21:20 0 of 41. 20:25 – 2026-10-01 01:50: 0 of 121 merges refused (5 conflicts, exit 2, never red).

Check-bottleneck session (jan-a8, owner-run, 2026-09-30): WP-930, 931, 932, 935, 936 (−68 s CPU per check), 938 (prettier cache root cause), 939 (prettier cache guard). Remaining cost: 38% of test CPU (240 of 639 s) is in 33 specs that spawn real tools (depcruise, eslint guardrail proofs). Proposal for the spec owners: ESLint `lintText(src, {filePath})` instead of planted files (console-rule.spec 20 s, also removes the plant races), and one batched depcruise call per spec (participant-imports 34 s, builder isolation, runtime-no-checker, boundary).

Event gap: lead-a logged no `start` or `review` events from about 20:00 to 22:00 (WP-150, 166–176), found by jan-41's monitor. lead-a backfilled them at 22:02 with times estimated to ±15 min, and lead-c folded them into `work/events`. Review counts for that window are right; review times are approximate.

Local-model FAIL fixes (owner decision 2026-09-30, `lead-loop.md` step 2; `python3 ~/lab/qwen-fix/qwen_fix.py report`): 23 rounds over three leads, all exited 0, no Sonnet fallback, no slot waits. 21 of 23 passed at the first re-review. The two FAILs were lead-b's WP-591 r1 (a vacuous guard that skipped string contents) and WP-595 r1 (a lead verdict on rewritten imports); both passed at r2. lead-a: WP-175, 177, 179, 180 and 181 r1, all PASS. lead-b: 13 rounds on 11 WPs, 11 PASS at the first re-review. lead-c: WP-918, 919, 921, 922 and 925, all PASS. Claude tokens saved: lead-b estimates 0.5–1 M Sonnet tokens in its lane (a Sonnet fix round costs 40–90k there; each Qwen round still needs one 15–35k Sonnet re-review). That is an estimate, not a measurement. Scope: narrow, precise FAIL lists (Log lines, one-file fixes, guard tightening, string moves).

Course check 004 (2026-09-30): 132 flaky-test events recorded, change failure rate about 24% (all red lands, refusals and review FAILs over lands). Both belong in the final numbers; lead-c refreshes them from `npm run -s metrics`.

Participant onboarding, the product gap course check 004 found, now exists: a CLI, the admin API, the builder Participants lens, and a QR image (WP-168, 176, 177). Anyone outside the roster fails closed (A-025).

## 4. Later topics, ranked
Index with priority: `docs/decisions/later/README.md`. The table ranks every open high and medium topic by how expensive a change becomes after the pilot or production, most expensive first (lead-a's reading of each file's "cost to change later"). "Decide by" is taken from the file; most files give no date.

42 topics: 9 high, 25 medium, 8 low. A-014 is superseded by A-025, and A-019 is superseded by A-021. That leaves 9 high and 23 medium topics open.

| id | topic | provisional choice | cost to change later | decide by |
|---|---|---|---|---|
| [A-002](../decisions/later/A-002-project-file-schema-v1.md) | Project file schema v1: key choices | as listed; `schema_version` plus `migrate(file) → latest` is the seam | "a `migrate` step per changed choice"; "highest for 2 and 3" | any time |
| [A-005](../decisions/later/A-005-course-check-001-decisions.md) | Key paths, stored compiled config, reserved words, sync forward-compat | dot-path keys, lists atomic; stored compiled config; `$` sigil keywords | "1 is the costliest after the build (every stored overlay)" | any time |
| [A-004](../decisions/later/A-004-schema-v1-gaps-from-corpus.md) | Schema v1 gaps found by the golden corpus | 13 schema additions (per-property `see`, `cardinality`, `creates`, `visible_when`, and more) | "9 is the costliest (a file migration over every `then.set`); 8 changes perms SQL generation" | any time |
| [A-023](../decisions/later/A-023-erasure-permission-admin-equality.md) | Erasure permission and restore replay tied to "all admins are equal" | A for now (no code change), B as the named direction | "after the pilot: every tenant's erasure task `when` must be reviewed" | before pilot |
| [B-006](../decisions/later/B-006-perms-actor-kinds.md) | Role allowlists bind participants only | A: admin, system and rule runs are not role-filtered | "every project file gains grants for admin/system subjects under B" | with A-023 (before pilot) |
| [B-005](../decisions/later/B-005-gdpr-erasure-redaction-first.md) | GDPR erasure: redaction first | C with B first: redaction run, crypto-shredding kept as a seam | "medium (schema flag stays; adding A means a codec on server and device plus key management)" | any time |
| [B-003](../decisions/later/B-003-3d-stack.md) | 3D stack | OGC 3D Tiles plus MapLibre custom layer with three.js | "medium (one renderer module; the view schema additions stay)" | any time |
| [A-022](../decisions/later/A-022-erasure-replay-actor.md) | Backup restore replays erasures as an admin restore actor | B: replay as an admin restore actor via `replayActor(entry)` | "a migration recording the actor's roles per erasure run, plus swapping `replayActor`" | any time |
| [A-009](../decisions/later/A-009-actor-roles-and-task-audience.md) | `actor.roles` only; task audience stays CEL | A: `actor.roles` only, no `actor.role` | "adding an active `actor.role` is additive; removing it later would need a file migration" | any time |
| [B-012](../decisions/later/B-012-device-sync-in-worker.md) | Device sync pipeline in a Web Worker | A: pull, plan and IndexedDB writes run in a dedicated worker | "high (every consumer would assume main-thread store state)" | any time |
| [A-003](../decisions/later/A-003-rule-language-parser.md) | Rule-language parser | A: hand-written subset parser | "one adapter module (~200 lines)"; history-function argument style "needs a `migrate` step over project files" | any time |
| [B-013](../decisions/later/B-013-self-contained-stored-config.md) | Self-contained stored config | A: `$ref` assets embedded once at ingestion | "medium (the stored files would need re-splitting into file plus assets)" | any time |
| [B-009](../decisions/later/B-009-primary-geometry-vs-index.md) | Primary geometry vs spatial index | A: declared primary geometry is the map geometry; index covers every geometry property | "medium (stored `features.geometry` would need a recompute on change)" | any time |
| [B-004](../decisions/later/B-004-device-facts-in-memory-mirror.md) | Device Facts in-memory mirror | A: synchronous in-memory mirror over IndexedDB | "medium (client store + run queue; core unchanged)" | any time |
| [B-001](../decisions/later/B-001-ui-primitives-scoped-css.md) | UI primitives use scoped CSS | A: scoped CSS on token variables, not Tailwind/bits-ui | "medium (rewrite 7+ primitives' styles)" | any time |
| [A-018](../decisions/later/A-018-mcp-apply-confirmation.md) | MCP `apply` confirmation | A: same-origin human step now | "medium: B needs a credential kind ... and admin UI" | any time |
| [A-024](../decisions/later/A-024-deploy-mappings-refuse-value-moves.md) | Deploy mappings refuse value moves | B: refuse breaking deploys that need value moves | "A as its own WP (a system-run executor, resumable)" | any time |
| [A-027](../decisions/later/A-027-admin-totp-enrolment.md) | First-time admin TOTP enrolment | A: stays an operator CLI step | "B is one auth WP ... plus a security review" | Phase 7 |
| [A-008](../decisions/later/A-008-admin-authorization.md) | Admin API authorization | A: any project membership | "a role registry, one check per admin route, a migration assigning existing memberships a role" | with A-023 (before pilot) |
| [A-017](../decisions/later/A-017-ogc-write-task-mapping.md) | OGC API write task mapping | C: write declares its task; DELETE answers 422 for now | "the resolver function plus its tests; D also needs a schema key" | any time |
| [A-013](../decisions/later/A-013-template-publish-authorization.md) | Template publishing authorization | A: any project admin may publish | "one authz function and a role" | any time |
| [A-011](../decisions/later/A-011-builder-draft-store.md) | Builder draft store | A: one shared draft per project, compare-and-swap | "add a `name` column, a list endpoint and a picker" | any time |
| [A-012](../decisions/later/A-012-expr-evaluate-60k-budget.md) | Rule evaluation budget at 60k features | A: budget derived from delta-visible | "two bench limits"; B is "a port adapter WP" | any time |
| [A-006](../decisions/later/A-006-qr-login-one-time.md) | QR login tokens one-time | A: one-time tokens | "one column in `credentials`, one branch in `exchange`" | any time |
| [A-025](../decisions/later/A-025-unknown-participant-refused.md) | Unknown participant refused | B: no roster row means 401 | "one line in `participantRolesOf` and its test" | any time |
| [A-001](../decisions/later/A-001-sqlite-driver.md) | Server SQLite driver | A: better-sqlite3 behind a `Db` interface | "one adapter file (~100 lines) plus a driver-parity test run" | any time |
| [A-021](../decisions/later/A-021-erasure-as-ordinary-run.md) | Erasure as an ordinary run | B: `redact` task run; admin erasure path removed | "re-add a thin admin route that submits the erasure task (no data change)" | any time |
| [B-007](../decisions/later/B-007-map-load-budgets.md) | Map load budgets | A: renderer init measured apart; 60k cluster build 1500 ms | "low (budget rows and one benchmark constant)" | any time |
| [B-008](../decisions/later/B-008-panzoom-software-gl.md) | Pan/zoom long-task row under software GL | A: median under software GL | "low (one aggregation choice in bench/browser)" | any time |
| [B-010](../decisions/later/B-010-node-bench-warmup-page.md) | Node bench warm-up page | A: exclude one JIT warm-up page | "low" | any time |
| [B-014](../decisions/later/B-014-feature-display-name.md) | A feature's display name is its first required text property | B: first `required` text property, else type label plus short id; C (a type-level `title`) later | "low (one function; C is additive)" | any time |
| [C-001](../decisions/later/C-001-docsync-keep-or-stop.md) | docsync on probation | C: keep, stop if edit-or-reject share stays above 50% | "nothing (a service toggle and a doc line)" | any time |

Low: A-007, A-010, A-015, A-016, A-020, A-026, B-002, B-011.

Top lock-ins (lead-a, final): the decisions that get most expensive once real projects exist.
1. A-023, with A-008 and B-006: erasure is open to every admin, admins are equal per project, and the restore replay depends on that. Decide before the pilot (§5).
2. A-002 and A-005: the project-file schema key choices and dot-path keys. Every stored overlay needs a `migrate` step once tenants exist.
3. A-004: the schema additions from the golden corpus. Changing `then.set` later means a file migration over every task.
4. A-024: deploys that need value moves are refused. The executor is a later WP behind `deployProject`.
5. A-021 and A-022: erasure is an ordinary run and is replayed under a restore actor. Changing the replay actor needs a migration recording roles per erasure run.

Erasure residual risks: no confirmation step beyond the typed id; replay depends on the journal-export cron; blobs are removed at the next sweeper run, not in the erasure transaction.

## 5. Needs owner
Source: `metrics/raw/needs-owner.md` (ranked there, with one question each). On 2026-09-30 22:30:
1. WP-303 pilot and cutover (real v3 data, production host, a date)
2. backup retention: legal sign-off
3. licence (O7): still an AGPL placeholder
4. a low-end Android measurement for the device budget rows (O3)
5. a real GPU for B-007 and B-008 (measured with software GL)
6. OIDC credentials (Phase 7)
7. the journal-export cron in production (restore replay of erasures depends on it)
8. A-023: decide before the pilot whether erasure stays open to every admin

## 6. Process lessons
Drafted by lead-c as they were learned, backed by metrics; 14 and 15 added by lead-a:
1. **Disk is a shared, silent failure.** Full-disk stalls cost 4.5 h. Every agent worktree ran its own `npm ci` (~890 MB). Fixes: housekeep (WP-139), hardlinked `node_modules` (WP-904).
2. **Load, not just RAM.** At load 219 on 64 cores, checks timed out and caused false reds. The gate covered full checks only. Fixes: light pool (WP-905), reviewers reuse a recorded green check (WP-906).
3. **Revert-on-red is expensive.** Each red land leaves a revert pair, marks the branch as merged and needs a manual revert-the-revert (a recurring lead mistake). Fix: land checks before main moves (WP-903).
4. **Wall-clock assertions in unit tests are flakes waiting for load.** Most of the 10% red lands were timeouts under load. Budgets belong in `bench/`, not in unit specs (WP-545, WP-547).
5. **Merge skew.** 3 reverts were typecheck errors from a signature that changed on main after the branch forked. After WP-903 and the WP-915 land train, a skewed branch is refused in staging or bisected out of the train, and it shows up as a conflict or refusal, not a revert. No skew refusal has been recorded since 2026-09-30 19:40; the 5 refusals since then were plain merge conflicts, resolved by a `git merge main`.
6. **Tests must never run whole-tree tools on the live repo.** A spec that ran `tsc -p tsconfig.json` on the working tree failed whenever another spec had a planted file (WP-908, refused 3 lands). Fix: config-level checks or mkdtemp copies (WP-914); reviewers now run a WP's new specs 5 times.
7. **A reviewer finds what a single green run hides.** Running new specs repeatedly found a 1-in-7 timing flake before land (WP-139.1). Adversarial reviewer prompts found a comment-injection path in generated code (WP-902) and a guardrail that missed a quarter of its targets (WP-913).
8. **The land queue becomes the bottleneck once reverts stop.** After WP-903, 4–5 lands queued on one lock at 5–10 min each. The land train (WP-915) checks up to 4 branches at once and bisects on red.
9. **Agent worktrees start from main, not from the lead's HEAD.** Land work-package files before dispatch.
10. **A steward lead pays off.** Before lead-c (all history until 2026-09-30 16:30), 44 of 427 lands were reverted (10.3%), and disk and load stalls blocked the product leads for hours. With a steward, red lands went from 12.5% (16:15–19:40, while the land and check tooling was rebuilt) to 5.9% (19:40–21:20), then 0 of 121 merges from 20:25 to 01:50. The only refusals since were merge conflicts (exit 2), which never touch main. No lead was blocked on disk or load after 17:00. The cost: one lead's tokens, three of its own red lands (the WP-908 and WP-915 specs), and one phantom-bench episode (lesson 12).
11. **Cheap fix rounds.** Since 2026-09-30 the local 27b writes review-FAIL fixes in rounds 1–2 and Sonnet still judges them. The first one passed on the first try. A precise, numbered FAIL list with the file, the failure case and the spec to add is what makes that possible. At least 8 of 9 known rounds passed at the first re-review (see §3). Counter-example: in WP-591 (lead-b), round 1 on the 27b produced a vacuous guard that skipped string contents. The Sonnet reviewer caught it, and round 2, from an exact spec, was correct. A vague FAIL item gives a vacuous fix, so the reviewer has to stay the judge.
12. **A benchmark harness must not measure itself.** `npm run bench` ran 55 bench files in parallel, and the strict run reported four server lines over budget that were all within budget when run serially. The per-line load figure didn't see the contention. Three work packages went after the phantom misses before lead-a questioned a number it couldn't reproduce. Budget rows describe one operation on the target device, so run benches serially (WP-921), and treat a miss that can't be reproduced in isolation as a harness bug first.
13. **Green e2e is not a working app.** Building the owner demo (WP-920) on the finished build found a blank map, because nothing imports MapLibre's stylesheet. It also found the view `camera` unused, `$ref` styles not resolved on deploy, no admin sign-in page, and a golden template task that can never bind. The Playwright suite checks the DOM, not what a person sees on another device over https. A demo run on a real device (and a visual check of the map) belongs in every phase exit, not only at the end. It happened again the next night. WP-597 fixed the cluster labels and passed review, but a fresh-device demo run by lead-c at 02:40 showed that it had broken the first draw: layers were added before their source, so a new device showed no single trees. The unit test's MapLibre fake did not throw on a missing source the way MapLibre does. WP-599 makes the fake strict and makes the first-sign-in e2e fail on console errors.
14. **Record process events when they happen, not later.** For two busy hours lead-a dispatched and judged 13 work packages without logging `start` or `review` events, so review rounds and the first local-model fix results were invisible until jan-41's monitor noticed. The backfill could only estimate times to ±15 min. Since WP-918 an event costs about 12 ms, so it belongs in the same step as the dispatch or the verdict.
15. **Land work-package files before dispatching, and don't touch a branch while it lands.** Dispatching WP-168 to 174 while their files were only on the lead's branch cost six extra land rounds of add/add conflicts (lesson 9 in practice). Committing to the lead branch during its own land broke a ref lock once. WP-924 now spells out background lands.
