# A-004 Schema v1 gaps found by the golden corpus
priority: high        status: provisional
date: 2026-09-29   lead: a   work packages: WP-011, WP-010.1   touches: O11, F5, F6, F9, F12, H2, H4

## Context
Writing the capability-driven corpus (WP-011) against schema v1 (A-002) exposed nine shapes the schema lacked. All are additive; each decision below is closed by WP-010.1.

## Chosen (provisional)
1. **Per-property `see`**: `permissions.see` takes an audience or a per-property map, symmetric with `write` (decision 0012). No property-level `visible_when` (one mechanism, R1). Undo: low. *(Revised after course check 001.)*
2. **Property type `localized_text`** (a registry entry, value is a `LocalizedString`) rather than a `localized: true` flag — the platform only knows property types (R4). Undo: low.
3. **Relations get `cardinality: one | many`** (registry `RELATION_CARDINALITIES`), default `one` for references, `many` for `derive:`. Traversal of `one` yields a feature, `many` a set (docs/06 macros). Undo: medium (changes check types).
4. **`inverse_of: <type>.<relation>`** declares a read-only reverse set; no edges are stored twice (F9). Undo: low.
5. **Tasks get `creates: <type key>`** — required when `on` is `$map` (a map-offered task always creates a feature); optional on `$none` (system-only tasks may create nothing; see item 12). Undo: low.
6. **Rules get `with: { <field>: <expr> }`** — form values for the system run. Undo: low.
7. **Rule trigger object form `on: { elapsed: { from, after, offset? } }`** and `on: { schedule: <cron> }`, with trigger kinds in a registry; the string form (`task.<key>`, property change) stays. Server-only (docs/07). Undo: medium.
8. **`permissions.visible_when: <expr>`** — the row-level filter that accepted decision 0012 already names (e.g. `self.gemeldet_von == actor.id`), compiled by perms to SQL through `toSql` (F6). `see` stays an audience. Undo: high once projects rely on it, but 0012 requires it. *(Revised after course check 001.)*
9. **`then.set` values: a string is always an expression, other scalars are literals.** A literal option key is written `"'massnahme'"`; compile adds a hint when a bare identifier equals an option key of the target. docs/05 is updated. Alternatives rejected: implicit option lookup (a special case, R4-adjacent) and an `=` prefix (a second syntax, R5). Undo: medium (a `migrate` step rewriting set values).

10. **Primary geometry is a property**: `types.<t>.geometry: <property key>` names a `geometry`-typed property; the kind is that property's option, from the one `GEOMETRY_TYPES` registry (no second list). More geometry properties are allowed; only the primary one is indexed (`features.geometry`, R*Tree) in v1. Removes the hidden built-in (R4, H1). Undo: medium.
11. **Option keys follow the key pattern** (letter first), so JS object order equals authored order (`v0`…`v4` with labels `0`…`4`). Undo: low.
12. **Value and visibility details (WP-010.1):** `with` follows the `then.set` rule; `set`/`with` values are scalars only; `on: $none` tasks need no `creates`. In `permissions.see` as a per-property map, the feature-level audience grants the feature and all unlisted properties, and listed properties are restricted to their audience; `write` denies unlisted properties. This keeps 0012's deny-by-default at the feature level without forcing every property to be listed. Undo: medium (perms semantics).
13. **`creates` semantics (WP-013.1):** in a task with `creates`, form fields and unprefixed `set`/`with` keys address the created feature; `self` stays the feature the task is offered on (absent for `$map`). A rule triggered by `task.<key>` sees the created feature as `self` when there is one, otherwise the task's feature. Undo: medium (plan semantics, file meaning).

## Seam
Every addition is optional and registry-backed; `schema_version` + `migrate(file)` covers later renames.

## Cost to change later
now: schema + fixtures · after the build: 9 is the costliest (a file migration over every `then.set`); 8 changes perms SQL generation.
