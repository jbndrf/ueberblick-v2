# A-047 A task form may show and edit a property of a bound Objekt (`<bind>.<property>`)
priority: medium        status: provisional
date: 2026-10-03   lead: a   work packages: WP-434   touches: H4, R3, R4, R5, R6, R14

## Context
Owner answer A5 (2026-10-03): a form entry may show and edit a property of any linked Objekt the task declares, not only the parent as in v3 (`FormEditorView.svelte:486-499`, `RelatedFieldPicker`, `related.read_only`). Saving writes to that Objekt within the same run. v3's client-built `target_instance_id` write path is not ported (R3).

## Options
- A) The form key is `<bind>.<property>`, where `<bind>` is a key of the task's `bind`. Everything else (`readonly`, `required`, `constraint`, `relevant`, `calculate`, `choice_filter`, `page`) is the existing field entry.
- B) A new field kind `related: { bind, property }` next to the property key: a second shape for the same thing, and every consumer (builder, renderer, plan) branches on it.
- C) Only `then.set` steps write bound features (status quo): the participant cannot see or edit the value in the form.

## Chosen (provisional)
A, because the key already has this shape in `then.set` (A-004 item 9) and in input keys, so there is one path grammar. Only `form` keys get the path form (`FormKeySchema`); `KeySchema` stays strict elsewhere.
- **Compile.** The bind must be declared, must yield one feature (a list is the existing `expression_type` bind problem), and the property must exist on its Objektart (`dangling_reference`: `bound_feature`, `property_of`). A computed property is `computed_written`; the process property is `process_property_written`. No new problem codes.
- **Prefill and validation.** `core.form` treats the bound Objekt's current value as the field's own value: `initial` prefills it (a preset or a `calculate` wins), `constraint`, `required`, `relevant`, `choice_filter` and `readonly` see it. `self` stays the task subject. `form['<bind>.<property>']` reads it from other expressions. `FieldState.bind` names the bind and the Objektart so the renderer can label the origin.
- **Write.** `plan` writes one observation per changed bind field on the bound Objekt, in the same run (all or nothing), through the overlay like `then.set`. A value equal to the current one writes nothing, an emptied one writes `null`. The actor needs write permission on that property (`denyWrites`, the check for a `then.set` on a bound feature); the refusal is `not_permitted` with path `form.<bind>.<property>`.
- **Missing Objekt.** A bind that has a form field is optional: if it yields nothing (or the Objekt is not on the device), the task is still available and the field is not relevant (not shown, not written). A bind without a form field keeps `bind_unresolved`. A `then` step that addresses the missing bind is refused `bind_unresolved`.
- **Read-only switch.** The existing `readonly: true` (or expression): the value is shown and never written. Editable is the default.
- **Seams (R13).** H4 assistants fill bind fields like any field (`initial` presets); an Objekt that is not on the device makes the field not relevant. `buildFormModel` takes the bound Objektarten from its caller (`bound`), so the renderer needs no config access.
Limits: a bind field on a `reference` property shows no prefill (a reference reads as a relation, not a value); the builder picker ("Verknüpftes Feld hinzufügen") is UI and follows.

## Cost to change later
now: one schema key pattern, one prepared-field attribute, one plan helper. After the build: switching to B would change every file that has a bind field (a migration that rewrites keys); the engine paths stay.
