# A-045 A rule trigger `{ when: <expr> }` fires once when a condition becomes true (false → true)
priority: medium        status: provisional
date: 2026-10-03   lead: a   work packages: WP-427   touches: H2, H4, R4, R5, R14

## Context
v3's rule editor had a trigger "when" (fire when a condition becomes true) and a fire-once option (`reference/src/lib/workflow-model/automation.ts:41,56`; register a3 row 176, E16). A v4 `change` trigger plus `when` fires on every change while the condition holds, so "notify once when the inspection becomes overdue" could not be said.

## Options
- A) A new trigger kind `{ when: <expr> }`: after a run, judge the expression on each touched feature before and after the run; fire on false → true. No stored state.
- B) A per-rule "fired" flag on the feature (v3's marker): state on every feature, a new write path, and it must be reset by something.
- C) A `change` trigger plus a hand-written `previous(...)` guard in `when`: works for one property, not for conditions over several properties or relations.

## Chosen (provisional)
A. Registry `RULE_TRIGGER_KINDS` gets `when` (object form, not server-only), schema arm `{ when: Expr }`, compile checks `bool` with `self` = the rule task's subject type (stored at `rules.<key>.on.when`). Plan (`packages/core/src/plan/when-edge.ts`): the "before" view is the overlay with the run's own changes undone: the touched features' properties (a created feature counts as false) **and the run's edge changes** (WP-430: edges it added are hidden, edges it removed are back, read from the run's own delta, never a scan), so re-arming falls out of the evaluation. Same cascade bound and trace as other rules; trace reason `already_true` (new) when it held before and still holds, `trigger_not_matched` otherwise. A condition that becomes true through time alone is the `elapsed` trigger's job: compile warns `when_trigger_uses_time` when the expression reads `now` or `today()`. Seam (R13): H4 and H2 can reuse `judgeWhenRules` for the same edge semantics on other event sources.
Limits: a feature is judged when a run changed one of its properties, created it, or added or removed an edge at it (so the parent of a new child is judged for `self.kinder.size() > 0`); a change to a *related* feature's property alone does not fire. The before view undoes the properties of the touched features and the run's edges, nothing else.

## Cost to change later
now: one registry entry, one schema arm, one plan file. After the build: switching to B would need a state column and a migration; rules in files stay valid under A.
