# B-027 A task form may list a computed property; it is display-only
priority: low        status: provisional
date: 2026-10-04   lead: b   work packages: WP-801, WP-804   touches: R3, R4, R15

## Context
v3 showed computed fields in the task form, read-only with "Wird beim Speichern berechnet" (`reference/src/lib/components/form-renderer/FieldRenderer.svelte:644-650`). The compiler refused a form that listed a computed property (`computed_written`), so WP-801's display could never appear.

## Options
- A) Allow it in `form`, display only; a run input carrying the key is refused (`invalid_input`). `steps`, `then` and bind targets still raise `computed_written`.
- B) Keep refusing; show computed values only outside the form.

## Chosen (provisional)
A, v3 parity and cheapest to undo. Seam: the one check in `packages/core/src/schema/compile/computed.ts` (`checkWrites`) and `unknownInput` in `packages/core/src/plan/run.ts`.

## Cost to change later
now: re-add one loop line. After the build: templates that list computed fields would need editing.
