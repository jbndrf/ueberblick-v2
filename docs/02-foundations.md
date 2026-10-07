# 02 · The thirteen foundations (binding)

Each foundation exists because v3 solved the same problem several times, each time differently. The numbering is the build order. Evidence for each claim is in `research/arch-0*.md`.

| # | Foundation | v3 problem it removes |
|---|---|---|
| F1 | **Identity & glossary.** Data IDs are UUIDv7, minted on the device. Config entities have **keys** (`baum`, `vitalitaet`). Keys are the contract with data and templates and are never renamed; labels change freely. | 3 ID schemes, slug mirrors, "tool" with 5 meanings |
| F2 | **One pure core with ports.** `packages/core` holds all domain logic and does no I/O. It runs on the device, the server, the builder and in tests. | 8 hand-synced "LOCKSTEP MIRROR" twins, a generated Goja copy |
| F3 | **One write path: run → plan → observations.** A ledger makes runs idempotent. Rules run after the plan as system runs in the same transaction, with a depth limit. | 4 write paths (fake admin edit, direct import, direct automation writes) |
| F4 | **Observations are the truth. No built-in domain properties.** The lifecycle (aktiv / abgeschlossen / archiviert / gelöscht) and audit metadata (created by, created at, last changed) are system-given, always written through runs (owner 2026-10-01, C-002); everything else on the map is a config-declared property. An append-only O&M log. `core.fold` is the only definition of current state. | 4 implementations of "latest value", special code for stage and geometry |
| F5 | **One rule language, four backends.** A CEL subset, type-checked against the config. Backends: `evaluate`, `toSql`, `explain`, `toChips`. Spatial functions use Simple Features names, and CQL2 is accepted at the OGC API. | 7 condition mechanisms, server-only formulas |
| F6 | **One permission model, compiled.** One section per feature type is compiled into an SQL predicate, a property allowlist and a planner check. Anything not allowed is denied. | 3 encodings, 6 config places |
| F7 | **One config document.** Zod schema, `schema:` version with migrators, `compile()` for semantic checks and a diff. ID-keyed maps, comment-preserving round trip, revision hash, no status inside the file. | ~15 config collections, 2 YAML formats |
| F8 | **One registry mechanism.** `define*({ key, schema, … })` for property types, functions, effects, tools and import formats. Enum values exist only here. | Scattered mini-registries, inline union copies |
| F9 | **Relations = references + derived edges.** A reference is a property value. A derived relation is a rule (`within(self.geometry, other.geometry)`). Both land in `edges`. `bind` follows declared relations only. | Relation catalog + link table + twin + a 15 m constant |
| F10 | **One view model.** A view is filter, sort, properties and style (MapLibre Style Spec). The same model serves map, lists, "my tasks", export, the OGC API and the sync scope. | 4 filter/view mechanisms |
| F11 | **Geometry & CRS in core.** WGS84 storage, `source_crs` on import. Derived values (bbox, point-on-surface, area centroid, m²) are computed once, in the fold. Predicates come from JSTS or GEOS, pinned by fixtures. | Vertex-mean centroid, holes ignored, silent CRS errors |
| F12 | **Cross-cutting types from day one.** `LocalizedString`; ordering by server `seq`, with device time as metadata only; content-addressed blobs; a versioned sync protocol; a simulation harness and golden corpus. | Single-language content, device clocks as truth |
| F13 | **Templates = base + overlay.** `extends: template@version` plus add / override / hide. Upgrades are a key-wise three-way merge, semver is enforced by the compiler, and data migrations are runs. | Copy-based sandbox forks: v2 could never be shipped |

## Corollaries (apply them without asking)

- A **task** has one primary feature (`self`). It may read and write related features only through declared relations (`bind`).
- **Form fields** use the ODK vocabulary: `relevant`, `required`, `constraint` (+ `constraint_message`), `calculate`, `readonly`, `appearance`. Values of non-relevant fields are not submitted.
- **"My tasks"**, "overdue" and similar lists are *views*, not features of the platform.
- **Map styling** uses the MapLibre Style Spec. CEL may compute a state property (e.g. `kontrolle_faellig`) that the style maps to icon and colour.
- **Tools** outside a task only read or start a task. Tools inside a task only produce field values, and the run stores them.
- The **builder** writes only the project file. It never writes database rows.
