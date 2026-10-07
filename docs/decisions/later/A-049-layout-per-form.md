# A-049 Layout per form: `column` and `row` on the form entry
priority: medium        status: provisional
date: 2026-10-04   lead: a   work packages: WP-450   touches: H3, R4, R11, R13

## Context
Owner answer A6 (2026-10-03): every form (task) has its own layout (field width, line, order); each view (how the data bottom sheet shows an Objekt) has its own; changing one never changes another. Until now width and line lived on the property (`display.column`, `display.row`, WP-659) and every form read them, so editing one form moved the others and the Daten view.

## Options
- A) Add `column` (registry `PROPERTY_DISPLAY_COLUMNS`: full, left, right) and `row` (number) to the form entry `tasks.<t>.form.<key>`. The form renderer and the form editor read and write only these; `display.*` is the Daten view's alone. Order was already per form (key order of `form`).
- B) Keep `display` as the default and let a form entry override it. Two sources for one thing; an edit in one form would still move the others until overridden.
- C) A separate `layout:` section per task. A second place to keep in step with `form`; overlays address entries by key path.

## Chosen (provisional)
A. Names `column` / `row` are the same keys and values as the view's, so the line rule (`formLines`: neighbours with the same row share a line, none = a line of its own) is one function (R1). No fallback to `display` (R11). A form with no `column`/`row` is one full-width field per line.

## Migration
Existing forms were laid out by the property's `display`. Done once, in the same work package: the golden template `baumkataster` 2.0.0 copies `display.column/row` of a property into every form entry of that property (forms `anlegen` and `kontrolle`); the `display` stays for Daten. Other fixtures had none. No runtime shim.

## Cost to change later
Low: two optional keys (schema, JSON Schema regenerated), one line in `buildFormModel` (UI and builder), one block in `layoutOps`. Going to B would add a fallback read in those two places.

## Seam
Per-role or per-view layouts (H3) can add the same two keys to their own entries; the layout functions (`layout.ts`, `formLines`) take cells, not properties.
