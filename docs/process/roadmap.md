# Roadmap

The work-package files in `work/` are the source of truth for status. This page is the overview, and the lead keeps it in sync. Phases 0 and 1 are refined. Later phases are coarse: the lead splits them into work packages (template in `work-package-template.md`) before the phase starts.

## Rebuild (owner, 2026-10-01): the v3 app on the v4 engine
Mission, lanes and checkpoints: `docs/process/rebuild.md`. Each step ends with an owner checkpoint.
- [ ] Step 1 · Run it like v3: Docker, `.env`, HTTPS proxy/direct, security, first admin, backup (lead-c)
- [ ] Step 2 · Participant core (lead-b)
- [ ] Step 3 · Admin core (lead-a)
- [ ] Step 4 · Workflow builder, deploy, preview (lead-a)
- [ ] Step 5 · The rest: chat, consent/legal, offline packs, info pages, GIS tokens, opt-in tools, preferences (lead-b participant side, lead-a admin side)

## Phase 0: specification before code
- [x] WP-001 Toolchain and guardrails
- [x] WP-010 Project file schema v1 *(O11 → A-002)*
- [x] WP-011 Golden corpus (capability-driven, **not** from v3 projects)
- [x] WP-010.1 Schema v1 gaps from the corpus *(A-004)*

## Phase 1: core without UI
- [x] WP-020 Rule language: parser and checker, plus parser spike *(O2 → A-003)*
- [x] WP-020.1 expr registries into registry/, total parse
- [x] WP-020.2 parser limits (nesting only, config/untrusted), checked history names *(A-005)*
- [x] WP-120 glossary-lint checks identifiers
- [x] WP-121 land.sh test harness, metrics label
- [x] WP-030 core.geo *(O6 → B-002)*
- [x] WP-012 Template merge, overlay, upgrade
- [x] WP-013 compile(): validation and diff
- [x] WP-010.2 View asset source + camera *(B-003, H1)*
- [x] WP-013.1 compile after the schema gaps (typed stored form, set rule, cardinality) *(A-004, A-005)*
- [x] WP-021 Rule language: evaluate and functions
- [x] WP-022 Rule language: toSql, explain, chips
- [x] WP-022.1 SQL follow-ups (IN collapse, Unicode case, months, inverse)
- [x] WP-040 core.fold
- [x] WP-042 core.perms
- [x] WP-041 core.plan with rules
- [x] WP-050 Simulation harness and golden runner
- [x] WP-556 fireRule + elapsed compile · WP-557 Rule trace · WP-558 canSeeRow · WP-563 plan bench creep · WP-564 property-test flakes
- [x] WP-566 Rule trace trigger discriminator *(A-016)* · WP-568 Core exports for the OGC API · WP-534.1 redact then-step

Parallel start: WP-010, WP-011, WP-020, WP-030 (their `owns:` globs don't overlap).

## Phase 2: server (refined by lead-a, 2026-09-29)
- [x] WP-100 SQLite schema, migrations, driver seam *(A-001)*
- [x] WP-102 core.sync protocol contract
- [x] WP-102.1 sync: ignore unknown columns within a major *(A-005)*
- [x] WP-101 bench harness, 60k generator, `npm run bench`
- [x] WP-103 Auth: QR credentials, sessions, admin + TOTP *(O10 default)*
- [x] WP-104.1 Facts over SQLite (read side)
- [x] WP-104 Run transaction (ledger, plan, fold, rules, outbox, seq), batches (H2)
- [x] WP-105 Run endpoint and atomic batches (HTTP, typed schemas = API, H4)
- [x] WP-106 Sync endpoint (snapshot, delta, gzip tuples, scope) + SSE doorbell
- [x] WP-107 Blobs and outbox worker
- [x] WP-108 Timers and derived-edge recomputation
- [x] WP-109 fromCql2
- [x] WP-110 OGC API Features (+ CQL2, Part 4 writes as runs, H6)
- [x] WP-111 CRS-aware import (as runs) and GeoPackage export
- [x] WP-112 Deploy pipeline (compile, diff, config_versions, index DDL)
- [x] WP-113 apps/web SvelteKit scaffold, auth hook, admin deploy API
- [x] WP-114 Admin bootstrap CLI, TOTP enrolment endpoints, rate limiting
- [x] WP-124 check covers apps/*; e2e script
- [x] WP-122 core subpath exports, sideEffects, shell-size bench
- [x] WP-122.1 depcruise subpath rule, import migration, real shell size
- [x] WP-123 every bench reports; bench tests in check
- [x] WP-123.1 bench lines map to docs/12 rows, ×4 device factor
- [x] WP-125 land reverts record their reason
- Phase end: every budget measured with `npm run bench`, numbers recorded here.

## Phase 3: device runtime
- [x] WP-510 IndexedDB store adapter, storage persistence, eviction guard
- [x] WP-511 Run queue: prediction, typed refusal, rebase
- [x] WP-512 Sync worker: snapshot, delta, doorbell, scope change
- [x] WP-513 Simulation against the real adapters
- [x] WP-560 Browser sync scenario (measured: fails, B-012) · WP-565 Chunked store writes (640 → 141 ms)
- [x] WP-567 Device sync pipeline in a Web Worker *(B-012)* (longest main-thread task 0 ms, offline copy 25.1 s)

Background: `docs/research/v3-device-runtime.md`. Coarse scope:
- IndexedDB store adapter (same ports), run queue with rebase, sync worker (ported design).
- Prediction through core, including event rules. iOS storage handling and queue export.
- Simulation harness against the real server adapter.

## Phase 4: participant app (coarse)
- [x] WP-501 Design system foundation (tokens, icons, field-proof primitives)
- [x] WP-520 Form renderer behind an evaluator port
- [x] WP-521 Map: maplibre-2d renderer, cluster worker, list alternative
- [x] WP-522 Participant app shell: role app profiles, honest status
- [x] WP-525 Feature sheet · WP-526 Task sheet · WP-527 Tool host + photo · WP-529/538 Map load budgets
- [x] WP-551 Draw tool · WP-552 Measure and search tools · WP-555 Store text index
- [x] WP-553 Public defineTool API
- [x] WP-549 Task sheet open within the tap budget
- [x] WP-550 Participant app route in apps/web (composition, e2e)
- [x] WP-576 Map tap, centre and overlay · WP-577 `$ref` styles embedded at ingestion, valid search sources *(B-013)*
- [x] WP-592 Map CSS and camera · WP-596 Fit edge cases · WP-597 Cluster counts on top · WP-599 Sources before layers
- [x] WP-593 Display names in lists and the sheet *(B-014)* · WP-594 Own lists · WP-600 Search hits show the type label
- [x] WP-585 Participant map e2e (Measure, Search); Measure hidden with the list
- [x] WP-578 Run queue schedules its own retry · WP-595 https-required notice
- Design system (outdoor contrast, touch targets of 56 px or more, KERN patterns). Form renderer (ODK vocabulary, error summary).
- MapLibre map from views (Style Spec), cluster worker, point-on-surface anchors, list alternative to the map.
- **Role app profiles** (H3): the shell renders the role's home view, tools, shortcuts and presets.
- Task sheet from `on`/`when`/`form`/`then`, with an honest sync status.
- Every UI work package does the journey check and keeps `docs/ia-map.md` current (R15).
- Tool host plus the first tools: photo, draw (evaluate terra-draw), measure, search. **Then** extract the `defineTool` API.

## Phase 5: builder (refined by lead-a, 2026-09-29)
- [x] WP-200 Document model (YAML round trip, overlay ops, revisions)
- [x] WP-212 Shell, navigation, problems panel, lens registry
- [x] WP-201 YAML lens · WP-203 Data model lens · WP-204 Process lens · WP-205 Task lens
- [x] WP-202 Simulator · WP-206 Roles & apps + permission matrix · WP-207 Map & views lens · WP-208 Rules lens + run log
- [x] WP-210 Diff, deploy, template publish, upgrade wizard
- [x] WP-211 MCP server (read, propose, simulate, apply; O15)

## Phase 6: migration and cutover (refined by lead-a, 2026-09-29)
- [x] WP-300 v3 config → template + overlay (synthetic fixtures)
- [x] WP-301 v3 data → import runs (synthetic fixtures)
- [x] WP-302 Differential v3-vs-v4 behaviour check (synthetic)
- [x] WP-303 Pilot and cutover runbook, scripted dry run
- **needs-owner:** real v3 exports, the pilot on a copy, the cutover itself.

## Phase 7: before selling to public bodies (coarse)
- [x] WP-502 Supply-chain hygiene: SBOM, SECURITY.md, security.txt, publiccode.yml
- [x] WP-530 GDPR erasure and export design (→ B-005)
- [x] WP-531 Backup and restore drill (Litestream)
- [x] WP-532 Admin OIDC login
- [x] WP-533 Schema: personal-data flag
- [x] WP-534 Erasure as a run (redact step, guarded purge)
- [x] WP-535 Subject data export
- [x] WP-536 Backup restore replays erasures
- [x] WP-537 Logging privacy rule
- [x] WP-554 Accessibility: automated checks, BITV self-check, statement
- [x] WP-554.3 Map zoom and position controls, map accessible name (WCAG 2.5.1, 4.1.2)
- Backup and restore drill (Litestream), GDPR package (crypto-shredding), accessibility statement and BITV self-check, OIDC and MFA, SBOM, security.txt, `publiccode.yml`.

## Horizon: not scheduled, but every phase must keep them possible (`docs/11-future-capabilities.md`)
- **H1** 3D layers (CAD/BIM via OGC 3D Tiles / IFC). Needs decision O13 and a spike before Phase 4 ends (WP-500 done → later topic B-003).
- **H2** Dispatch and realtime assignment from the builder, QGIS or an assistant. Needs O12 (teams).
- **H4** Participant and admin AI assistants (ephemeral views, proposed runs). Needs O15.
- **H5** Command-centre live positions. Needs O14.

## Course checks
| # | date | range | verdict | actions |
|---|---|---|---|---|
| 004 | 2026-09-30 | 7f608d5..b159124 | drifting (mild) | 8 (A1–A8) + 2 later topics → WP-168 (roster + QR credentials), WP-169 (deployProject), WP-170 (store composition), A-024 + WP-171 (refuse value moves), WP-172 (converter emits erasure task), A-023 (admin roles vs erasure/restore); lead-b: core localize, expr-sql derivedFrom, personal_without_redact; lead-c: strict bench, flakes, docsync, roadmap/index; land WP-163, WP-150 |
| 003 | 2026-09-29 | ad74304..7f608d5 | drifting | 11 → WP-104 split (104.1), A-009 + WP-011.1, WP-122.1, WP-123.1, WP-125, docs sweep (03, 07 pin, A-005 corr., statuses); lead-b: WP-042 → available() + core/form before WP-041, UI hold, WP-511 batch+code, flake/ATTENTION, docsync cap |
| 002 | 2026-09-29 | 49e1a88..ad74304 | drifting | 11 → critical-path rule (021/022, contracts), WP-010.2, WP-013.1 ext., WP-122, WP-123, tooling lane, reviewer checklist, docs/07 refetch, WP-112 redeploy rule, lead-b asks (WP-042 split, 520–522 deps, 510/512 acc., sbom flake) |
| 001 | 2026-09-29 | 3de4d19..49e1a88 | drifting (mild) | 14 → A-004 (rev.), A-005, WP-010.1, WP-013.1, WP-020.2, WP-102.1, WP-106 acc., WP-121, reviewer checklist, lead-loop critical-path rule |
