# A-052 Rule-language function `multiple_of(value, step)` for the number step
priority: low        status: provisional
date: 2026-10-04   lead: a   work packages: WP-457   touches: R5, H4

## Context
v3's number field had "Step" for decimals too (`FieldConfigPanel.svelte:781-786`, e.g. 0.5 or 0.01). WP-439 offered it for whole numbers only: `%` needs ints and the rule language has no rounding.

## Options
- A) One function `multiple_of(value, step)`: exact decimal check by scaling with the step's decimal places. Pure, null in gives null, step <= 0 or more than 9 places is an error.
- B) Allow `%` on doubles: binary floats give wrong answers (0.3 % 0.1).
- C) No decimal step: v3's element lost.

## Chosen (provisional)
A. `packages/core/src/expr/functions/numbers.ts`, registry entry, `check` types it `(double, double) -> bool` (ints widen). The field panel writes `multiple_of(value, <step>)` for integer and decimal fields (one grammar, R1); the old `value % n == 0` form is no longer written or read. No SQL translation (core evaluates it, as `matches`).
Seam: more number helpers join `NUMBER_FUNCTIONS` without touching the checker.

## Cost to change later
One registry entry; files that use it stay valid as long as the function exists.
