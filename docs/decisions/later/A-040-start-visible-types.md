# A-040 Erststart "Sichtbare Objektarten": `on_at_start` and `values_at_start` on the type
priority: low        status: provisional
date: 2026-10-03   lead: a   work packages: WP-397   touches: H3, R13

## Context
v3's Erststart had "Sichtbare Workflows" (`StartupSection.svelte:286-350`): an "Alle" switch, a checkbox per Objektart and, per Objektart, the stages or classifying values visible at start. v3 stored it per project (`startup.workflow_ids_visible`, `visible_tag_values`). WP-386 parked it: v4 had no slot, and the participant's `FilterState` starts empty (everything on).

## Options
- A) **On the type**, mirroring `map.layers.<k>.on_at_start`: `types.<t>.on_at_start: false` and `types.<t>.values_at_start: [..]`. Absent means on and all values.
- B) Per role: `roles.<r>.app.start_hidden`. Right for H3, but v3's setting was project-wide and the admin edits it once.

## Chosen (provisional)
A. It is one setting for the project, as v3, and the same shape as the layers' flag. "Alle" is derived (every type on), not stored, so the file has no second truth.
- The values are those of `classifyingProperty(type)`, the property the participant filter groups by (R1). Compile problems: `start_value_unknown`, `start_values_without_property`.
- `startFilter(file)` (core, `filter/start.ts`) returns the participant filter's start state in the filter's own shape; a type off hides all its values, and all values off hides the type, as the filter does.
- **Seam:** `startFilter` is the one reader. A per-role start set (H3, role apps) is a second argument there, with option B's slot read before the type's.
- The participant app applies it once, as it does the layers; that is lead-b's change.

## Cost to change later
low: two optional keys and one function; moving them to the role app is a template migration of two paths.
