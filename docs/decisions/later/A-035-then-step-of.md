# A-035 Then-steps act on other features: optional `of` on `lifecycle` and `set`
priority: medium        status: provisional
date: 2026-10-02   lead: a   work packages: WP-374 (WP-371 uses it)   touches: H2, H4, R14

## Context
Owner answer A2 (2026-10-02): v3's relation options ("Wenn das Eltern-Element gelöscht wird": mitlöschen, trennen, blockieren, and "Anbindung") are visible rules, not a hidden relation setting. Two of them were inexpressible: `lifecycle` acted only on the task subject, and `set` reached a bound feature only through a `one` relation, so never a list of children.

## Options
- A) A `$lifecycle` rule trigger plus a fan-out rule: a second mechanism, the coupling hides in `rules`, away from the task.
- B) Optional `of: <expr>` on the `lifecycle` and `set` then-steps (chosen): the step applies to each feature the CEL expression names. One mechanism, visible in the task, canvas and code view.
- C) A relation setting on the type (`on_parent_delete: cascade`): a hidden engine behaviour, against the owner's answer.

## Chosen (provisional)
B. Details:
1. `of` is a CEL expression (R5) that type-checks to a feature or a list of features (`self.kinder`, `self`). Anything else is `expression_type` at `…then["i"].of`. It is accepted on `lifecycle` and `set` only (`redact` has its own `of`).
2. The step applies to each distinct target, in list order. Without `of`, behaviour is unchanged.
3. `set` keys with `of` are properties of the target type (`dangling_reference` otherwise); a bound-feature key (`area.x`) with `of` is `expression_type`. The value is evaluated once, per step, against the task's own scope, and stored per target.
4. Permissions: each target is checked as if the actor ran the step on it, with the checks the subject gets today: `canDelete` for `lifecycle: deleted`, property write permission for `set`. One refused target refuses the whole run (a run is atomic). The refusal of a delete names the target (`not_permitted`, path `types.<type>.permissions.delete`, message with the feature id).
5. Bound (R14): at most `THEN_STEP_TARGETS_MAX` (registry `limits.ts`, 100) targets per step. More is refused `too_many_targets`. The targets come from the relation's edges, never from a scan of all features.
6. Rules still fire once per run subject, as before: the run's observations on other features do not add subjects.
7. Compile checks that read the unprefixed `set` keys as the subject's properties (`computed_written`, `dead_option`) address the target type or stay conservative when `of` is present.
8. Not covered here, expressible already: blockieren (`when: self.<children>.size() == 0` on the delete task) and Anbindung (the child's creating task).

Seam (R13): H2 (dispatch) and H4 (assistants) can close all open sub-tasks with `of`. Another step kind joins `THEN_STEP_KINDS` without touching `of`. The cap is one registry number.

## Cost to change later
now: one schema key, one plan file (`plan/then-of.ts`), one compile branch · after the build: removing `of` breaks projects that use it; raising the cap is a number.
