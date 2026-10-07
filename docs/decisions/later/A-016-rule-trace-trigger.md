# A-016 Rule trace entries name their trigger (run or timer), not an optional causedBy
priority: low        status: provisional
date: 2026-09-30   lead: a   work packages: WP-208 (rules lens), lead-b WP-556/557   touches: docs/06 rules, docs/08 rules lens, H4 assistants

## Context
WP-557 gave `plan(…, {trace:true})` a per-rule trace (`RuleTraceEntry`) whose `causedBy` (the triggering run) is required. WP-556 adds `PlanApi.fireRule` for `on.elapsed` rules fired by the timers loop (WP-137), and these have no triggering run, so they currently produce no trace entry. The rules lens run log (WP-208) therefore cannot show why a time-based rule did or did not fire.

## Options
- A) `causedBy` becomes optional; absent means "timer".
- B) A trigger discriminator from the registry (R6): `trigger: { kind: 'run', causedBy } | { kind: 'timer', dueAt }` (chosen).

## Chosen (provisional)
B. Absence of a field is not a meaning (A would make every consumer guess). New trigger kinds (import, external event, dispatch, docs/11) add a registry value instead of another optional field. The seam is the registry enum of trigger kinds; the rules lens renders by kind.

## Cost to change later
small: one type in core plus the rules lens renderer; trace entries are not stored, so nothing needs migrating.
