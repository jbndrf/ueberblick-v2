# @ueberblick/builder

The project-file builder (docs/08-builder.md): the headless document model (`src/doc`, WP-200), the problems list (`src/problems`), the simulator (`src/simulate`), the MCP server (`src/mcp`), the pure helpers the builder shares (`src/lenses`, `src/shell`) and v3's builder UI (`src/v3`, below), which is the only builder UI. The first build's lens UI is gone (WP-423).

## Document model (`src/doc`)

```ts
import { openProject } from '@ueberblick/builder';

const doc = openProject(templateSrc, overlaySrc); // throws DocOpenError on bad YAML / schema / extends mismatch
const { doc: next, problems, refused } = doc.apply({ kind: 'set', path: 'types.baum.label', value: 'Baum' });
next.effective(); // template.merge(template, overlay).file
next.provenance(path); // 'template' | 'changed' | 'added'
const { overlaySrc, revision } = next.save();
doc.replaceOverlay(typedText); // the Code view: { doc, problems } or { refused }; keeps the text byte for byte
next.saveIf(currentRevisionInStore); // { ok: false, reason: 'stale_revision' } when the store moved on
```

- **Only the overlay is edited.** The template source and data are never touched. A `Doc` is immutable: `apply` returns a new one, and the old one is the undo step.
- **Ops** (`Op`): `set` (an `override` entry, an edit inside an added entity, or `inputs.<key>`), `add` (an `add` entry), `hide` / `unhide` (a `hide` entry), `reset` (drops the overlay entry at exactly that path). Paths are key paths (A-005); lists are atomic, so `hide` is edited by entry and nothing addresses a list index.
- **An op never silently does nothing (R11).** `apply` either changes the effective file as the op says or sets `refused` (with a reason) and returns the same Doc. A `set` on a path the template lacks is written as an `add` by `apply` itself, so lenses send `set` for "change this value" and never choose between `override` and `add`. Refused: a path that is hidden, locked, absent in a parent (a `hide` of nothing, an `add` of an existing path, an `add` into a missing map), and an edit below a parent that an earlier `set` made a single value (`set`, `add` and `reset` below it; `reset` the parent first). `reset` and `unhide` of something not there, and a repeated `hide`, are not refusals: the state asked for already holds and the same Doc comes back. Creating a missing parent map (a type's first `relations` map) is still the caller's `add` of the map.
- **`replaceOverlay(text)`** replaces the whole overlay by typed text. It parses and checks it like `openProject` (YAML, overlay file schema, `extends` matches the template), and `save()` returns the text unchanged, comments, key order and layout included, until the next op (which edits that text as a `yaml` Document). Invalid text is `refused` (empty `path`) and the Doc is unchanged. The revision stays the opened one, so `saveIf` still guards stale saves. An effective file that breaks the schema is accepted and reported as `schema_invalid` problems, as when opening.
- **Round trip.** `yaml` `Document` keeps comments, key order and flow style; a doc without edits saves its opened text byte for byte. A replaced entry keeps its comment and style.
- **Problems** are `problemsFromMergeIssues(merge issues)` followed by the `compile` problems and warnings of the effective file, recomputed after every op (about 3 ms on the largest golden template, `bench/builder-doc`). A file that breaks the file schema is not compiled: its Zod issues are `schema_invalid` problems in the same list, and `apply` refuses (`refused`) any op that turns a valid file invalid.
- **Revisions.** `revision` is `contentHash` (core, SHA-256 over canonical JSON) of the overlay text. `saveIf(expected)` succeeds only when `expected` equals the revision the doc was opened from; the returned doc is rebased on the new revision.
- **Entity YAML (Code view, `entity-yaml.ts`).** `doc.entityYaml('types.baum')` returns `{ text, lines }` (the effective YAML of one type, task, rule or property, with `{ line, path, provenance }` per line). `doc.applyEntityYaml(path, editedText)` returns `{ ok: true, ops }` (minimal: `set` changed value, `add` new key, `hide` deleted template key, `reset` deleted added key or value back to the template's) or `{ ok: false, problems }` (YAML error with `line` / `column`, `lock_violation`, a refused op, new compile problems). Nothing is applied: apply the ops with `applyOps(doc, ops)` (`apply-ops.ts`) — it folds them over `apply` and adopts only the last Doc, so a refusal drops the whole fold and the original Doc is untouched (all or none; the ops were pre-tried, so a refusal is not expected).
- No DOM and no I/O: the MCP server (`src/mcp`, docs/08 "MCP server") and assistants call the same ops (H4).

## Shared helpers (`src/shell`, `src/lenses`) and problems (`src/problems`)

The first build's lens views and shell components were deleted in WP-423. What stays is pure code the v3 builder, the server or the MCP route import.

```ts
import { messages, labelOf, locate, problemsReport, BUILDER_BUNDLE_MARKER } from '@ueberblick/builder';

problemsReport(doc, 'de'); // { revision, count, problems: [{ path, code, message, hint?, location }] }
```

- **`shell/`**: `messages(locale)` (the builder's Paraglide translator), `locate` / `labelOf` / `taskLocation` (where a key path sits in `Project > feature type > task`), `focusPath`, the condition chip helpers (`shell/conditions`) and `BUILDER_BUNDLE_MARKER`.
- **`lenses/*`**: pure models and ops only (`model.ts`, `ops.ts`, `edit.ts`, `graph.ts`, `layout.ts`, `trial.ts`, `diagnose.ts`, `plan.ts` ...). `lenses/versions` is the headless part of the Versionen page (`VersionsApi`, `buildPlan`, `startUpgrade`). Some modules have no production importer left (listed in the WP-423 Log); they stay until a later clean-up decides.
- **Problems** are `problemItems(doc, locale)`; the Probleme view and the HTTP route use the same function (H4). There is no severity yet because `Doc.problems()` does not carry one.
- **UI text** is Paraglide, like `packages/ui`: `messages/{en,de}.json` in this package, compiled to `src/paraglide/` (generated, git-ignored) by `npm run i18n -w @ueberblick/builder` (typecheck and Vitest do it automatically). `shell/i18n.spec.ts` fails on a locale missing a key and on unsorted message files (`npm run messages:sort` fixes them). Design-system parts come from `@ueberblick/ui`.
- **Isolation**: nothing in `packages/ui`, `packages/client`, `packages/tools` or `apps/web/src` outside `routes/(builder)`, `routes/(admin)` and `routes/api/mcp` may import the builder (depcruise rule `participant-no-builder`, proven by `shell/isolation.spec.ts`; `shell/boundary.spec.ts` checks the same on the file tree). `BUILDER_BUNDLE_MARKER` is rendered by the v3 shell (`data-builder`); `apps/web/e2e/builder-bundle.spec.ts` (part of `npm run e2e`, fails without a build) proves the participant entry and root layout do not link a chunk holding it.

## Simulator (`src/simulate`)

```ts
import { openSimulation } from './simulate';

const r = openSimulation(doc.effective()); // { ok: false, problems } when the file does not compile
const sim = r.simulation;
const id = sim.generate('baum'); // or sim.seed([{ type, properties }])
sim.availability(id, actor); // every task of the type: { ok } or { ok: false, refusal, explanation } (core.expr.explain)
const out = sim.submit({ task: 'kontrolle', actor, feature: id, input }, { commit: false }); // dry run
// out.ok: runs (depth, causedBy, rule, observations), changes (before/after state), ms; else refusal
```

- **Core unchanged (R2):** `core.plan` (`availableFor`, `planFor`, `fireRuleFor` with `oneVersion(config, perms)`: the simulator has one version), `core.form`, `core.perms` and `core.fold` do all the work. The simulator's state is core's `MemoryStore` (`@ueberblick/core/memory`), the one in-memory `Facts` (a dry run works on `clone()`); `simulate/session.ts` only lists live features and records observations under the run that made them. There is no second planner.
- **Headless (H4):** plain data in, plain data out; the assistant's `simulate` tool (WP-211) calls the same functions. `submitBatch` is atomic like `plan`.
- **Budget:** one simulated run (three-run chain) about 0.2 ms, limit 50 ms (`simulate/session.perf.spec.ts`). The first build's simulate view is gone; `lenses/simulate/model.ts` keeps its pure form helpers.
- **Known gap:** `MemoryStore` does not yet skip edges to a missing (never created) feature, as the server does; `simulate/store.spec.ts` marks it `it.fails` until core fixes it.

## v3 builder frame (`src/v3`, WP-330)

v3's workflow builder, rebuilt on the `Doc` (rebuild step 4). `BuilderFrame` (`packages/builder/src/v3/shell/BuilderShell.svelte`) is the page of one Objektart: toolbar (Speichern through `Doc.saveIf` and the host's `onsave`, view switch Workflow, Modell, Code, problems badge, name), `CatalogSidebar` on the left, the registered view in the middle, the registered inspector on the right.

- `createBuilderRegistry()` is the plug point: `registerView(view, component)`, `registerInspector(kind, component)` (kinds in `SELECTION_KINDS`) and `registerFocus(hook)` for a problem entry. Components take no props; they read `getBuilderContext()` (`type`, `doc()`, `selection()`, `select()`, `apply(op)`). Nothing registered shows a placeholder.
- The catalog's creation is `createOp(file, type, request, locale, names)` (pure; the drag payload types are `CATALOG_MIME`); the lists are `buildInventory(doc, type, locale)`.
- `parseView` / `withView` keep `?view=` in the address. The host (`apps/web/.../types/[type]/builder`) owns the draft client, the leave guard and the address.
- `v3/kit/*.d.ts` and `paths` in `tsconfig.json`: the type view of the design kit (`@ueberblick/ui/components/ui/button|input`) for this package's `svelte-check`.
