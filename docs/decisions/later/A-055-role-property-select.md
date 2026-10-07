# A-055 `role` properties take the participant `select`: "Nur Selbstauswahl" / "Kann jeden auswählen"
priority: low   status: provisional
date: 2026-10-04   lead: a   work packages: WP-481   touches: packages/core (registry/property-types, registry/participant-select, plan/role-choice, schema/property-select), packages/builder (v3/form/entity, EntitySelectorModal), apps/web (participant form choices), docs/05

## Context
v3's Rollen source let the admin say who may pick which role: "Nur Selbstauswahl" (a participant may only pick one of their own roles) and "Kann jeden auswählen" (any role) (`EntitySelectorModal.svelte:372-405`). A-051 added the `role` property type without them.

## Options
- A) Reuse the participant property's `select: { all?, self? }` (B-022, WP-725) on `role`: one shape, one helper family (R1).
- B) A new `role_select` option with its own shape.
- C) Keep the form-entry `constraint` grammar of the participant source: it is about `actor.id`, so it cannot say "a role the actor holds".

## Chosen (provisional)
A. A role in `all` may pick any role; a role in `self` only roles it holds; any other none (v3's default deny). No `select` offers every role (unchanged from A-051, so existing files keep working; participant properties differ: absent there means self). Both lists empty in the builder takes `select` out. `allowedRoles(property, actorRoles, declaredRoles)` lives in `registry/participant-select.ts` next to `participantChoice`; the device form (`choices.ts`) offers its result and plan refuses a bound actor's pick outside it (`not_permitted`, `form.<property>`). An import, a rule or the system writes any declared role, as for participants.

R13: H3 (role apps) keeps its seam: the role key is unchanged, `select` only narrows who may write it. H4 (dispatch): a role-valued assignment property can now be limited per role without a rule.

## Cost to change later
now: low · after the build: low (an optional property option; removing it widens what is allowed).
