# Golden corpus

The executable behaviour spec for v4. WP-011 wrote it, WP-050 runs it. `corpus.spec.ts` (this WP) is only a **structural gate**: it proves the corpus is well formed, closed over its vocabulary and covers every capability. It executes nothing.

**Written from the target capabilities** (`docs/00-vision.md`, `docs/02-foundations.md`), **not derived from v3 projects**. That is the owner's explicit instruction: v3 projects were built for v3's limits and would make the scope look smaller than it is.

Scenarios may name functions, task keys and schema keys that core does not implement yet. **The schema wins.** Every template and overlay passes `parseProjectFile` and every expression string parses with `parse` (`corpus.spec.ts`). There are no exceptions: since WP-010.1 the corpus validates fully, and the gate fails if a `pending_schema` list reappears. `then.set` and rule `with` string values are gated as expressions (a literal option key is written `"'massnahme'"`). Refusal codes stay provisional until WP-041. Not yet gated: type-checking (WP-013).

## Layout
```
vocabulary.yaml                     closed lists: foundations, step kinds, refusal codes, problem codes, capability tags
templates/<key>/<version>.yaml      published templates (3 domains, see below)
candidates/<key>/<version>.yaml     template versions offered for publishing that must be refused (semver check)
projects/<name>.yaml                overlays (extends <template>@<major>)
seeds/<name>.yaml                   shared given-data, included by scenarios
styles/*.json                       MapLibre Style Spec fragments referenced by views (renderer maplibre-2d)
scenarios/<area>/<name>.yaml        one behaviour each
bench-spec.yaml                     generator spec for the 60k-feature benchmark dataset (bench/ implements it)
corpus.spec.ts                      the structural gate (npm run test:golden)
```

| Template | Domain | What it stresses |
|---|---|---|
| `baumkataster` 1.0.0, 1.1.0, 2.0.0 (incl. `flaeche_anlegen`, which creates areas; `templates/baumkataster/template.spec.ts` checks compile and the task) | tree cadastre | bind, derived within/intersects, references, ODK fields, per-property permissions, timers, inputs, lock, upgrade with migration |
| `maengelmelder` 1.0.0 | defect reporting | rule chains, depth limit, timers from inputs, localized text (de/en/uk), row-level `see`, dispatch batches (H2), role apps (H3) |
| `veranstaltung` 1.0.0 | event approvals | derived many-to-many relation, relation sets (`all`), status flow, 3D geometry (H1), `visible_when` |

## Scenario format
```yaml
scenario: <file name without .yaml>
title: one sentence
foundations: [F3, F4]                 # which of F1-F13 it exercises (required, at least one)
capabilities: [bind, timer]           # coverage tags from vocabulary.yaml (required)
given:
  project: projects/x.yaml            # or template: templates/x/1.0.0.yaml
  include: [seeds/x.yaml]             # seed participants and features, merged first
  now: "2026-05-01T08:00:00Z"         # the injected clock (core never reads a clock)
  platform: { rule_depth_limit: 2 }   # platform constants the scenario overrides
  participants: { anna: { roles: [kontrolle] } }      # alias -> roles (actor kind participant)
  features: { t1: { type: baum, properties: { … } } }  # alias -> feature; merged by alias into seeds
when:                                 # steps run in order, ids s1, s2, …
  - { id: s1, kind: run, task: kontrolle, actor: anna, feature: t1, input: { … } }
then:
  steps: { s1: { outcome: accepted, observations: [ … ] } }   # per step
  features: { t1: { properties: { … } } }                     # state after all steps
  edges: [ { from: t1, relation: flaeche, to: park, derived: true } ]
  edges_absent: […]   timers_end: […]   history_kept: { … }   effective: { <config path>: <value> }
```

- **Aliases** (`t1`, `park`) name features. The runner maps each to a deterministic UUIDv7. `creates: $new:x` binds an alias to a feature a step creates. A rule may create one too (`$new:m1` in `rule_runs`).
- **Seeds are facts, not runs.** They arrive as observations of actor kind `import` before `when` and bypass tasks, like a restored backup. Derived edges and timers exist after seeding.
- **Actors:** an alias from `participants`, or `{ kind: admin|system|import, id: … }`.
- **Step kinds** (the closed list is in `vocabulary.yaml`): `run`, `batch` (`atomic`), `advance`, `import` (`source_crs`), `export`, `upgrade`, `publish`, `compile`, `view` (saved, `sync_scope`, or `ephemeral`), `app_profile`, `resolve`, `replay`, `replay_refused`, `explain`.
- **Step results** use a small fixed vocabulary: `outcome` (`accepted`, `refused`, `partial`, `blocked`, `review`, `dry_run`, `failed`), `refusal` (a code from `vocabulary.yaml`), `problem` (a compile problem code), `observations`, `observations_absent`, `rule_runs` (with `depth` and `caused_by`), `fired` (timers), `no_trace` (no observation, seq, feature or edge remains; a refused run keeps its rejected `runs` ledger row), `ids` / `rows` (view results), `clipped`.
- **Value matchers** inside expected values: `{ approx: n, rel_tol | abs_tol }` for numbers, the literal `identical_to_input` for round trips.
- **Every refusal has a code** from the registry. The list in `vocabulary.yaml` is provisional until WP-041 fixes it.

## Semantics the corpus assumes (provisional; the lead records them as later topics if they stay)
1. Platform default rule depth limit is a platform constant (`platform.rule_depth_limit`), and exceeding it refuses the **triggering** run and rolls back the whole transaction.
2. Role allowlists (`create`, `write`, `see`) bind **participants**. Actors of kind `system`, `import` and `admin` are not subject to role allowlists, but the task's `when` still applies to them. Rules act as `system`.
3. A required `bind` with no related feature refuses the run (`bind_unresolved`). A run may only touch related features named in its `bind` (`bind_undeclared`).
4. Time-based rules fire only on the server, when the injected clock passes `due_at`. A timer follows its source property and is dropped when the rule's `when` is false.
5. Point-on-boundary is `intersects` but not `within` (OGC Simple Features).
6. Sort by a `select` property follows the option order.
7. Division by zero and other evaluation errors yield null; in filters null counts as false and the error is reported.
8. A run recorded against a config version that no longer exists goes to `review`, never silently dropped (docs/07).
9. Hiding an element that another element still uses is a compile problem (`hidden_referenced`).

## Extensibility scenarios (docs/11)
| Scenario | Horizon |
|---|---|
| `geo/geometry_z_roundtrip` | H1: Z coordinates survive plan, fold, snapshot and export. Views name a `renderer` (`maplibre-2d`); an unregistered renderer breaks the file schema (`schema_invalid`). |
| `dispatch/batch_assign_30`, `dispatch/batch_atomic_rollback` | H2: 30 features, 10 each to 3 participants, one atomic batch, one seq range, one doorbell. |
| `roles/role_app_profiles` | H3: two roles, two app profiles, two different views of the data. |
| `roles/own_lists_without_position` | H3: an own-list shows features without a position (a work order for its handwerker, a report for its melder). Run against the participant list by `apps/web/.../own-lists.golden.spec.ts`, because the golden runner skips `view` steps. |
| `roles/ephemeral_view_clipped`, `roles/ephemeral_view_hostile_filter` | H4: runtime views clipped by permissions; untrusted filters cannot probe or crash. |

## Benchmark dataset
`bench-spec.yaml` describes the 60,000-feature dataset for `bench/` (types, counts, clustering, history depth, assignment, delta sizes). The generator is deterministic from its seed.

## Adding a scenario
1. Pick or write the template, overlay and seed. 2. Write the scenario with `foundations` and `capabilities`. 3. Use only vocabulary codes. 4. `npm run test:golden` must stay green. A new capability tag goes into `vocabulary.yaml` first, so the coverage gate covers it.
