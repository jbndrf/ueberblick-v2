# apps/migrate

Migration tool from Überblick v3 to v4. WP-300 converts the **configuration** (`src/config`), WP-302 checks behaviour (`src/diffcheck`), WP-301 converts the **data** (`src/data`). It is tested on synthetic v3 fixtures only. Real v3 data is a needs-owner item.

## Commands and the dry run (WP-303)

`npm run migrate -w @ueberblick/migrate -- <command>` (`src/cli.ts`, `src/cli-run.ts`): `convert <v3-project> --out <dir>`, `diffcheck <v3-project> <v3-runs>`, `import <v3-project> <v3-data> --dir <dir> [--key <key>]`, `dry-run [fixture]`. Exit code 0 done, 1 a check found a problem, 2 wrong use. `dry-run` (`src/dry-run`, `dryRun()`) runs convert, diffcheck, import project, data migration into a fresh project database and a verify step on a synthetic fixture (`fixtures/v3-synthetic`); the first failing step ends it. The steps are `DRY_RUN_STEPS`. The runbook that maps every step to a command is `docs/process/cutover-runbook.md`. Test: `npm test -- apps/migrate/src/dry-run apps/migrate/src/cli.spec.ts`.

## Contract

```ts
import { convertConfig } from '@ueberblick/migrate';

const { template, overlay, report, mapping, check } = convertConfig(v3Export);
```

- **Input:** the parsed v3 `ProjectDefinition` (`format: 1`, the key-based export of `reference/src/lib/server/definition/types.ts`). A YAML tree export is joined into that object by the caller. Anything else throws `V3ExportError`.
- **`template`:** a `TemplateFile` (`schema: ueberblick/1`, key from the project name, version `1.0.0`). It holds roles with app profiles, feature types, tasks, rules and views.
- **`overlay`:** an `OverlayFile` that `extends: <key>@1`. It holds what belongs to this project rather than to the blueprint: the map position (`override: views.karte.camera`) when it differs from the default. Customers keep template upgrades this way (F13).
- **`report`:** one entry per v3 item with a status (`mapped`, `approximated`, `dropped`) and a reason for the last two. The items are the v3 paths, for example `workflows.baum.tasks.kontrolle.conditions.0`. The report always accounts for 100% of the input: an item that no step handled is added as `dropped` with the reason "not handled" (tests assert that this never happens on the fixtures). `report.warnings` repeats the `compile` warnings of the converted project (for example dead options), so an admin sees them next to the items. `report.stray` lists ids that the converter reported but that are not in the input (a bug if not empty).
- **`mapping`:** where every v3 key went (feature type, property, option label to option key, role, task). WP-301 needs it to convert data.
- **`check`:** the converted project (template merged with the overlay) run through the schema and `compile`. `check.ok` is true when there is no schema issue and no compile problem; `warnings` (for example dead options) do not fail it.

## What the converter decides

| v3                                                                                                                                                                                             | v4                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| workflow                                                                                                                                                                                       | feature type; a `geom` geometry property; a `stage` select property (default: the start stage)                                                                                                                     |
| field (11 types)                                                                                                                                                                               | property; `dropdown`, `multiple_choice` and `smart_dropdown` become select or multiselect, option labels become option keys                                                                                        |
| computed field (`write_mode: computed`)                                                                                                                                                        | property that the roles of the tasks that compute it may write (`permissions.write`); a computed field that no participant task sets stays writable by system runs only                                            |
| `contains` on text                                                                                                                                                                             | `x.lower().contains('v'.lower())` (v3 ignored case)                                                                                                                                                                |
| `instance_reference` with `multiplicity: many`                                                                                                                                                 | a relation of cardinality many on the owner (`inverse_of`) plus a reference property on the target type that points back at the owner; `related` conditions read it with `exists` / `all` / `size`                 |
| custom table                                                                                                                                                                                   | lookup feature type without geometry; selector fields become references                                                                                                                                            |
| workflow relation catalog                                                                                                                                                                      | reference property on the child, inverse relation on the parent                                                                                                                                                    |
| role                                                                                                                                                                                           | role with an app profile (home, views, tools)                                                                                                                                                                      |
| task                                                                                                                                                                                           | task: entry tasks are `on: $map` (or `$none` without geometry) with `creates`; others are `on: <type>`; clauses become one `when` expression                                                                       |
| triggered task, standalone rule set                                                                                                                                                            | a system task (`when: actor.kind == 'system'`) plus a rule; every step is one task and rule                                                                                                                        |
| effects                                                                                                                                                                                        | `then` steps; `create_instance` on another type becomes a separate task that creates it                                                                                                                            |
| private cases, ownership                                                                                                                                                                       | a `created_by` participant property, a row filter in `permissions.visible_when`, set at creation                                                                                                                   |
| e-mail field; text field or participant selector whose key or label has a whole word from the list in `personal.ts` (`melder`, `telefon`, `kontakt`, `adresse` ...; `zustaendig` is not on it) | property with `personal: { subject: actor }`, listed in `ConvertResult.personal` and by `convert`; when any exists, the task `erase_subject` (admins only, a `redact` step) and the type `erasure` (WP-172, A-021) |
| status effects and clauses                                                                                                                                                                     | a `lifecycle` select property                                                                                                                                                                                      |
| data tabs, map                                                                                                                                                                                 | views (`karte`, `<type>_liste`, `<type>_<tab>`)                                                                                                                                                                    |
| `map_defaults`                                                                                                                                                                                 | camera of the map view (template default, overlay override)                                                                                                                                                        |
| `icon_config`, `marker_color`                                                                                                                                                                  | `types.<t>.marker` (WP-357): an SVG icon becomes `icon: { svg, size }` with `style.color` as `color`, else `marker_color`; an icon without `svgContent` is ignored, as v3 did                                      |
| filterable tag, `filter_value_icons`                                                                                                                                                           | `types.<t>.classify` (WP-357): the stage (`filterBy: stage`) or a single-choice field names `property`; per-value icons map stage key or option label to the option key; the last filterable tag wins              |

Every feature type also gets two import tasks (`converted.imports`), so the data conversion can write import runs (R3): `<type>_import` (`on: $none`, `creates`) and `<type>_import_update` (`on: <type>`), both with a form of every property and `when: actor.kind == 'import'`, so no participant gains a permission. `convertConfig(v3, { target: 'import' })` also leaves the rules out of the template and returns the compiled project as `target`. It is not a v3 item and does not appear in the report.

`check.warnings` and the report come from a compile of the project **without** the import tasks, `check.problems` from the full project: the import forms write every property, which would hide `dead_option` and raise `task_field_not_writable` (the actor kind `import` is no role), although neither says anything about v3.

Rules that keep the output safe:

- **Fail closed.** A clause that cannot be translated (unknown field, unknown operator, a value that does not fit the property) becomes `false` and is reported as approximated or dropped. Nothing widens silently.
- **Output always compiles.** Values are converted only when their type fits (a formula that gives a number is not written to a date property). Otherwise the item is dropped with the reason. A property test draws random v3 configurations and asserts `check.ok` and a complete report.
- **Unknown parts** of the input (columns, settings, kinds) are kept in the inventory and reported as dropped.

## Modules (`src/config`)

| File                                 | Responsibility                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `read.ts`, `read-parts.ts`           | the only files that spell v3 key names; they build the neutral model (`model.ts`) and the item inventory       |
| `registry.ts`                        | report statuses and the v3 vocabulary (R6)                                                                     |
| `build.ts`, `properties.ts`          | feature types, properties, relations                                                                           |
| `exprs.ts`, `formula.ts`             | conditions, values and v3 formulas as rule-language expressions                                                |
| `effects.ts`, `tasks.ts`, `rules.ts` | effects, tasks, triggered tasks and rule sets                                                                  |
| `personal.ts`                        | the rule list for personal fields and the erasure task and type (WP-172)                                       |
| `finish.ts`                          | stage, geometry, permissions, record columns                                                                   |
| `classify.ts`                        | `marker` and `classify` from v3 icons and the filterable tag (WP-357); SVGs go through core's `checkMarkerSvg` |
| `app.ts`                             | views, role apps, settings, unmodelled parts                                                                   |
| `convert.ts`                         | orchestration and the `check`                                                                                  |
| `concepts.ts`                        | the checklist of v3 concepts (arch-01) and the function that finds which a fixture uses                        |
| `testing.ts`                         | fixture loader and the generator of large projects (tests only)                                                |

## Tests

`npm test -- apps/migrate`. The fixtures are `fixtures/v3-synthetic/config/*.yaml`, built from the documented v3 shapes, not from real projects. `convert.spec.ts` holds the acceptance tests (concept checklist, compile, 100% report, glossary lint on the output, performance), `behaviour.spec.ts` the conversion rules, `property.spec.ts` the random-project test (`FC_RUNS=12000` for a longer run).

## Known gaps (reported, not converted)

Icons and classifying (WP-357), each reported on the v3 column with the v3 workflow id: a filterable tag on a multiple-choice field gives no `classify` (`classify_property_invalid`; v3 never matched those icons); a `filter_value_icons` key that is neither a stage key nor an option label is dropped (`classify_value_unknown`); an SVG that `checkMarkerSvg` rejects is dropped (`marker_icon_invalid`); non-default `style.shape`, `borderWidth`, `borderColor`, `backgroundColor` and `shadow` are not carried, named once per icon (B-018 item 4). Whether the owner's real export holds such values is needs-owner.

Other gaps: basemaps and overlays (`map_layers`), info pages, consent texts, saved filter presets, chat, role quotas, `elapsed` triggers (v4 has no created or stage-entered time in rule expressions), the previous stage in a transition trigger, functions of the v3 formula language beyond arithmetic, comparisons and `if`. Each has a reason in the report; the ideas for closing them are in the work package notes.

## Differential check (`src/diffcheck`, WP-302)

`diffcheck` replays recorded v3 task runs through the converted project (`core.plan`, with the perms and the form of core) and lists every behavioural difference with a reason. It is tested on synthetic runs only; real run logs are a needs-owner item, and the tool reads the same format.

```ts
import { convertConfig } from '@ueberblick/migrate';
import { diffcheck, formatReport, parseRuns, summarize } from '@ueberblick/migrate/diffcheck';

const converted = convertConfig(v3Export);
const runs = parseRuns(parsedRunsFile); // a list of V3Run; throws RunsError with the place of the problem
const differences = diffcheck(runs, converted); // Difference[]; empty means v4 agrees on every run
console.log(formatReport(summarize(runs.length, differences)));
```

**Input, `V3Run`** (`types.ts`; fixtures in `fixtures/v3-synthetic/runs/*.yaml`):

| Key                      | Meaning                                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `workflow`, `task` | the run id, the v3 workflow (or custom table) key and the v3 task key                                                                                                                                     |
| `actor`                  | `{ id, roles }`; the roles are v3 role keys                                                                                                                                                               |
| `instance`               | the instance before the run: `stage`, `status`, `createdBy`, `values` by field key, `related` (one instance per `instance_reference` field). Absent for an entry task. Without a `status` it is `active`. |
| `input`                  | the submitted form values by field key                                                                                                                                                                    |
| `geometry`               | GeoJSON position (an entry task without one gets a point at 0,0)                                                                                                                                          |
| `now`                    | time of the run in ms; default 2023-11-14                                                                                                                                                                 |
| `recorded`               | what v3 did: `outcome` (`accepted` or `refused`), `reason` (free text, never compared), `stage` and `values` after the run (compared when given), `known` (see below)                                     |

Values are converted with the mapping of `convertConfig` (`mapping.types[..].properties`: option labels to keys, numbers, lists), the same map the data conversion uses.

**Every run is replayed alone**: the instance it saw is seeded as a feature, `plan` runs, the resulting observations are folded, and the features are removed again. The order of the runs does not matter (a property test checks it).

**Output, `Difference`:**

| Key        | Meaning                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| `runId`    | the run                                                                                                        |
| `kind`     | `outcome` (accepted against refused), `value`, `stage` (both accepted, the result differs) or `not_replayable` |
| `v3`, `v4` | what each side did, in one phrase (v4 refusals carry their code)                                               |
| `cause`    | why they differ, see below                                                                                     |
| `reason`   | the detail, then the reasons of the explaining items                                                           |
| `items`    | the ids of the conversion report items that explain it                                                         |

**Causes** (`registry.ts`):

- `reported`: an approximated or dropped report item can have caused it. Which items count depends on what differs (a refusal for a condition: the task's conditions; for a property the actor may not write: that field's items; for the form: the task's steps and the touched fields; a value or stage: the field, the effects and the rule sets). Layout-only notes never count.
- `known`: the run carries `recorded.known`, a note by the person who curated it (why v4 differs, what follows). It applies only when a difference is found, so a stale note is harmless.
- `not_convertible`: the run names a task, workflow, field, option or value that the conversion has no counterpart for, or an instance that v4 cannot hold (for example a single-valued reference that v3 filled with several instances).
- `unexplained`: nothing explains it. It is a converter bug, a v3 quirk or a wrong recording, and must be fixed or noted before the cutover. `summarize(...).unexplained` counts them.

`formatReport` prints one block per difference (unexplained first) and a last line: `<runs> runs, <n> agree, <m> differences (reported a, known b, not_convertible c, unexplained d)`.

**The v3 eval-core corpus.** `evalCoreScenario(cases)` turns the 52 cases of `reference/pb/pb_hooks/eval-core.fixtures.json` into a synthetic v3 project (one task per case; field kinds derived from how the clauses use them) and 52 runs whose recorded outcome is v3's tri-state result (`pass` accepted, `fail` and `invalid` refused). `evalcore.spec.ts` pins the outcome: 45 cases agree, 7 differ, none unexplained. `knownFor` holds the notes for the one remaining gap (v3 compared text NFC-normalised; v4 does not, WP-301 writes text as NFC) and for the `invalid` cases (a state v4 cannot be in).

**Findings on the synthetic fixtures** (also pinned by tests): `baumkontrolle` replays with one difference left, the run of a task that the project does not have (`not_convertible`). A migration never grants more than v3: a field that v3 showed in a task's form but did not let the task's roles write is left out of that form and reported as approximated ("shown read-only in v3").

**Speed.** 10,000 runs take about 1.3 s on the development machine (limit: 1 minute), because one compiled project serves all runs, each replayed in its own core `MemoryStore`.

## Data conversion (`src/data`, WP-301)

Turns a v3 data export into batches of **import runs** (actor kind `import`) for the converted project. It is the only write path (R3): the batches go through `Store.submitBatch`, so plan, permissions and the fold apply. Creations use `planRows` of `@ueberblick/server` (the import pipeline of WP-111: coerce, reproject, validate); history and links are update runs built here, because `planRows` serves creating tasks only.

Timers: the import project carries no rules, so the import schedules none. The timers of the migrated features exist once the real project file is deployed after the import: `deployProject` runs `rebuild` over every live feature (`docs/process/cutover-runbook.md`). `data/store.spec.ts` proves the production path (import without rules, then `deployProject` of the real project leaves the timer rows) and, separately, the hook (an `elapsed` rule in the import config schedules while the import runs).

History order: per property, observations keep v3's recording order, so the folded state is v3's. References are written in a last phase, so across **different** properties the `seq` order differs from v3. Read a feature's history across properties by `phenomenon_time`, not by `seq`.

```ts
import { convertConfig } from '@ueberblick/migrate';
import { migrationStore, readDataExport, runMigration } from '@ueberblick/migrate/data';

const converted = convertConfig(v3Definition, { target: 'import' }); // without rules: history must not fire them
const target = converted.target; // merged project with the import tasks (set when `converted.check.ok`)
// `migrationStore` deploys the import project through `deployProject` (a run needs a deployed version) and returns
// the server's `composeProjectStore` (the runtime's composition, timers hook included) over `target.config`.
const { store, geo, configVersion } = migrationStore(db, target, clock);
const result = await runMigration(store, readDataExport(v3Data), converted.mapping, {
  target,
  geo,
  configVersion,
});
result.problems; // what could not be carried over, by v3 id
result.ids; // v3 id to feature id
```

`convertData(v3Export, mapping, options)` is the generator underneath, `migrate(store, batches, ids)` the driver. Deploy the full project (with rules) after the import.

**Input, `V3DataExport`** (`types.ts`; fixtures in `fixtures/v3-synthetic/data/`, from `docs/research/arch-03-data-model-geometry.md`): `instances` (`id`, `workflow`, `status`, `stage`, `created_by`, `created_at`, `geometry`, `centroid`, and `log`), `table_rows` (`id`, `table`, `values`). `log` is the v3 field value log in insertion order: `field` (or `system: stage | status | geometry` for what v3 projected onto the instance), `value`, `observer`, `phenomenon_time`, `recorded_at`, `submission_id`. `readDataExport` checks the shape, turns the v3 keys into the neutral model (`V3DataExport`: camelCase names, `run` for the v3 run id, `tableRows`), and throws `DataExportError` with the place. Nothing else in `src/data` spells a v3 key.

**Phases** (`DATA_PHASES`, in this order): `tables` (rows of custom tables), `create` (one feature per instance: position, stage, status, creator, and the first submission when it happened at creation time), `history` (one update run per later submission), `links` (references, once every feature has its id). A batch is built only when the consumer asks for it, so the consumer submits it first; `migrate` learns the feature ids from the results and the `links` phase reads them.

**Rules of the conversion**

- **History order** is the recording order of v3 (`recorded_at`, ties by position in the export); a run's `clientTime`, and so the `phenomenon_time` of its observations, is the observed time (`phenomenon_time`, else `recorded_at`). References go last, so across different properties the sequence differs from v3; per property it is v3's.
- **Position.** v3 GeoJSON is WGS84; `planRows` normalises and validates it (Z kept, H1). The v3 `centroid` is not converted; v4 derives the anchor with core.geo (`not_carried` in the report). A feature type needs a position: an instance without one is reported (`no_geometry`) and left out, and so is its history.
- **Text** is NFC (v3 compared NFC-normalised). Dates and date-times are normalised, options map through the conversion mapping (`no_counterpart` when the option is not in the project).
- **References.** A single reference takes the first target (`reference_dropped` when there were several). A many-valued field is written on the children through `inverse.property`, and cleared on a child when a later list drops it. Targets are v3 ids, or for a custom table selector the value of a column when unique.
- **Permissions.** The import tasks have `when: actor.kind == 'import'`; nothing is granted to a participant. The rules are left out of the import project, because v3 automations already ran.
- **Files** are not converted (the export holds no bytes): `not_carried`.

**Resume.** Run ids derive from the v3 id (`runIdFor`), so converting the same export twice gives the same ids, and the store answers a run it already holds from its ledger. Batch indices are stable for one input. `after(batch, next)` can stop the run; store `checkpoint(next, ids)` (JSON) and pass it as `resume`. Resuming one batch too early is safe. A batch the store refuses is retried run by run under derived ids, so one bad record is one `refused` problem, not a lost batch. Problems of batches that were skipped on resume are not reported again.

**Speed** (`bench/migrate-data`, 60k features, 140k runs, 361 batches of 500 records, in-memory SQLite, loaded development machine): 25 s in total, 6.5 s conversion and 18.6 s store. Budget 10 minutes. Real exports have more history per feature (v3 measured about 18 log rows per case); the store cost grows with the run count.

| File                                             | Responsibility                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `read.ts`                                        | the one place that spells the v3 data key names; timestamps             |
| `history.ts`                                     | log rows to submissions, in recording order                             |
| `prepare.ts`, `values.ts`                        | one instance as create values and steps; one v3 value as a v4 value     |
| `import-config.ts`                               | the import project (import tasks with forms, no rules)                  |
| `build.ts`                                       | the runs of one phase for one chunk of records                          |
| `convert.ts`, `migrate.ts`, `store.ts`, `ids.ts` | the generator, the driver, the store, deterministic ids and checkpoints |
| `registry.ts`                                    | phases, problem kinds, v3 system fields (R6)                            |
| `testing.ts`                                     | fixtures, the 60k generator, snapshot helpers (tests only)              |

Tests: `npm test -- apps/migrate/src/data`. `migrate.spec.ts` (golden state `baumkontrolle.expected.yaml`, history, geometry, NFC, resume at every batch, permissions), `problems.spec.ts`, `property.spec.ts` (random logs: `FC_RUNS`), `scale.spec.ts` (6k in `npm run check`; the 60k case belongs to the long profile, `npm run sim` sets `SIM`; shared body in `scale.testing.ts`).
