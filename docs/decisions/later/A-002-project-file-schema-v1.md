# A-002 Project file schema v1: key choices (O11)
priority: high        status: provisional
date: 2026-09-29   lead: a   work packages: WP-010   touches: O11, O12, H1–H4, F7, F13

## Context
O11 (the exact schema of the project file) needs an owner review. In autonomous mode WP-010 fixed schema v1 (`packages/core/src/schema/`, `schema/ueberblick-1.schema.json`); these are its choices that are expensive to change once projects exist. Every change after release needs a `migrate(file)` step.

## Choices (each provisional, with its undo cost after the build)
1. **Strict objects everywhere** (unknown keys rejected). Undo: low — loosening is backwards-compatible.
2. **Entities are ID-keyed maps**, keys `^[a-z][a-z0-9_]*$`. Undo: high — every file, overlay path and diff depends on it.
3. **Overlay `override` / `add` / `hide` / `lock` use dotted key paths.** Undo: high — changes template upgrade (F13) and every stored overlay; needs a file migration.
4. **`ProjectFile` = template or overlay, discriminated by `template` vs `extends`** (`parseProjectFile`). Undo: medium.
5. **`then` steps support only `set`, `when`, `otherwise`**; effects come later through a registry. Undo: low — additive.
6. **Task `on`** is a feature-type key, a list of keys, or an offer from a registry (`map`, `none`), so `map`/`none` cannot be used as type keys with `on`. Undo: medium — renaming would need a file migration.
7. **Permission audiences** are `all` or a list of role keys; `write` may be per property. No team concept yet (O12) — a future `teams` audience is additive. Undo: medium.
8. **Property types come from `PROPERTY_TYPES`** (registry); per-type options validated through the registry. Undo: low — additive.
9. **Role app profiles** `roles.<key>.app` (home, views, tools, shortcuts, presets, ui) — minimal, H3. Undo: low — additive.
10. **Views/layers carry `renderer`** from `RENDERERS` (only `maplibre-2d`); style is opaque per renderer (H1). Undo: low.
11. **`rules.on`** is a loose dotted-string pattern until a trigger registry exists. Undo: low — tightening is planned (WP-013/WP-020 follow-up).

## Chosen (provisional)
As listed. The seam: `schema_version` in every file plus `migrate(file) → latest` (docs/03), so any choice can be migrated rather than broken.

## Cost to change later
now: schema files + fixtures · after the build: a `migrate` step per changed choice, regenerated JSON Schema, builder lens updates; highest for 2 and 3.
