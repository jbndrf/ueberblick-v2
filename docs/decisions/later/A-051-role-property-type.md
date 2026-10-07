# A-051 Entity selector: Rollen as a source is a `role` property type
priority: low   status: provisional
date: 2026-10-04   lead: a   work packages: WP-455   touches: packages/core (registry/property-types, form/type, plan/role-choice, schema/compile/env), packages/ui (form, feature-sheet), packages/builder (v3/form/entity), apps/web (admin data columns, participant form choices), docs/05, docs/06, docs/08

## Context
v3's entity selector offered "Auswählen aus: Rollen" beside Tabelle and Teilnehmende (`EntitySelectorConfig.svelte`, register a3 row 167). v4 had reference and participant properties (WP-393, WP-443) but no property that holds a role.

## Options
- A) A registry property type `role`: the value is a role key of the project (cardinality one|many like reference and participant), checked against `roles` in plan, drawn as the choice input of the role labels, shown as labels in cells and the sheet. One registry entry plus its switches (value check, expression type, input kind, formatter).
- B) A `select` property whose options are copied from the roles: stale as soon as a role is added.
- C) A `participant` property with a `select`-like role filter: a role is not a person.

## Chosen (provisional)
A. The value is the role key, so rules read it as a string (`self.zustaendig_rolle in actor.roles`, `string` or `list<string>` with `many`). Plan refuses a key the file does not declare for every actor (`invalid_input`, `form.<property>`); an empty value passes. The picker lists every role of the file with its label; no per-role visibility. H3 (role apps) keeps its seam: a role key is the same key `roles.<r>.app` uses.

v3's Rollen source also showed "Nur Selbstauswahl" and "Kann jeden auswählen". For a role those mean "own roles only" against "any role"; v4 does not offer them (the engine's constraint grammar is about `actor.id`). Listed under Verify later of WP-455.

## Cost to change later
now: low · after the build: low (a registry entry; removing it is a property type change, `type_changed`).
