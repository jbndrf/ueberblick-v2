# 10 · Reference map: reading v3 (`reference/`)

`reference/` is the v3 source (SvelteKit + PocketBase/Go + Goja hooks), exported from branch `stage/dbperf`. It is **read-only**. **Since 2026-10-01 v3's UI is the spec** (`docs/process/rebuild.md`): its routes (`src/routes/(participant)/**`, `src/routes/admin/**`), components (`src/lib/components/**`, `src/lib/workflow-builder/**`), layout, interactions and labels (`messages/de.json`) are ported and adapted to the v4 engine. Its *data layer* is not (anti-patterns below). The element-by-element mapping is in `docs/research/v3-parity/register/`. The `researcher` subagent answers questions like "how did v3 do X?" with file references.

## Worth learning from (behaviour, edge cases, numbers)
| Topic | Where in `reference/` | Take away |
|---|---|---|
| Condition semantics (tri-state, NFC compare, null handling, operator set) | `src/lib/workflow-model/eval-core.ts`, `pb/pb_hooks/eval-core.fixtures.json` | Edge cases for the CEL corpus. The fixture cases are a good seed. |
| Task-run planner checks and refusal codes | `src/lib/workflow-model/task-run.ts`, `src/lib/registry/enums.ts` (`TASK_RUN_*`) | The list of checks a plan must perform, and refusal-code naming |
| Field types and value validation | `src/lib/registry/field-registry.ts`, `src/lib/registry/field-value-rules.ts`, `field-value-codec.ts` | The property-type catalogue and per-type validation edge cases |
| Sync protocol (snapshot, delta, tuples, streaming gzip, capped history, scope fingerprint) | `pb/readmodel/sync.go`, `scope.go`, `rows.go`; `docs/dev/read-model.md` | The protocol design and the performance lessons |
| Device sync pipeline, stores, workers | `src/lib/participant-state/case-sync.ts`, `case-pipeline*.ts`, `case-store.svelte.ts`, `db.ts` | Worker pipeline, IndexedDB layout, interning, version signal |
| Run queue, prediction overlay, dependent refusal | `src/lib/participant-state/task-run-queue.svelte.ts`, `task-run-facts.ts` | Queue states. v4 replaces the dependent-refusal cascade with rebase. |
| Map at scale | `src/lib/components/map/MapCanvas.svelte`, `src/lib/workers/cluster-worker.ts`, `family-stack.ts` | MapLibre, Supercluster worker, icon pipeline. Known issue: an O(N) rebuild on each page. |
| PMTiles writer and offline packs | search `pmtiles`, `ubpack`, `pack-downloader.svelte.ts`, `tile-pack-store.ts` | Pack format and download flow |
| Form rendering and paging | `src/lib/components/form-renderer/`, `map/modules/workflow-instance-detail/tools/form-state.ts` | UX details: paging, hidden-value pruning, the prefill bug fixed in `cf984b6` |
| Perf tooling | `stress-tests/perf/seed-perf.ts`, `bench.mjs`, `scripts/dev/case-sync-probe.mjs`, `map-scale.mjs` | Seeding 60k features and headless measurement. Port the idea for v4 benchmarks. |
| Automation engine behaviour | `pb/pb_hooks/automation.js`, `automation_sweep.js` | Trigger semantics, chain-depth guard, sweep budgets. |
| Concept discussions | `docs/dev/workflow-modellierung-*.md`, `workflow-relations.md` | The owner's earlier thinking on modelling and relations |

## Anti-patterns: never reproduce these
| v3 pattern | Why it is banned | v4 instead |
|---|---|---|
| Client/server "LOCKSTEP MIRROR" twins (`instance-projection.ts`, `instance-links.ts`, `task-run-facts.ts`, slug, timestamps, geometry, cron) | Drift, doubled work | One core (F2) |
| Generating Goja JS from TS (`gen:eval-core`, `gen:task-core`) | Build hack forced by two runtimes | TS everywhere |
| PocketBase collection rules + planner checks + `scope.go` for one visibility rule | Three encodings | `core.perms` compiled (F6) |
| `workflow_definitions.document` + `workflow_field_defs` + `tools_automation` + `tools_field_tags` + `workflow_relations` | Config spread over stores | One file (F7) |
| `project_to`, SQL triggers maintaining `current_values`, projection hooks | Four definitions of current state | `core.fold` (F4) |
| Stage and geometry as special system fields | Special paths everywhere | Ordinary properties (F4) |
| Hand-written server-only formula parser (`evaluateExpression`) | Can't run offline | One rule language (F5) |
| Admin `updateFieldValue` faking an `admin_edit` submission; direct CSV import writes | Bypasses the write path | Runs (F3) |
| Sandbox clone/pushback, draft-live vs deployed | Copies lose provenance | Template + overlay (F13) |
| Inline unions duplicating registry enums | Drift | Registry only (F8) |
| 2,800-line `map/+page.svelte`, 1,700-line detail module | Unreviewable | ≤ 400 lines, headless logic modules |
| Vertex-mean centroid, bbox-only spatial queries | Wrong results | `core.geo` (F11) |
| *(superseded 2026-10-01)* 90-day token in the login URL | The owner decided v3's login stays: admin-chosen or generated reusable tokens, token tab, QR scanner and link, sliding session, info-page variables | v3 login, with revocation and HttpOnly cookie (`docs/research/v3-parity/comparison.md` §10.21) |
| Per-feature "tool" meaning five different things | Confusion | Glossary (F1) |
