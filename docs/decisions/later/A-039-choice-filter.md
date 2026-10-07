# A-039 Choice filter on the form entry, option hints on the property
priority: medium        status: provisional
date: 2026-10-02   lead: a   work packages: WP-392   touches: H4, H6, R5, R13

## Context
v3's Smart Dropdown made the options of a select depend on an earlier answer and let an option carry an explanation text (register E13, plan E-25). Decision 0015 chose ODK's field vocabulary, whose answer is `choice_filter`.

## Options
- A) `choice_filter` on the form entry (`tasks.<t>.form.<p>`), `option_hints` on the property. ODK keeps the filter per form; the filter reads `form.*`, which exists only in a task form; two tasks may filter one property differently. The hint belongs to the option, so it is the same everywhere.
- B) `choice_filter` on the property. It would read `form` outside a form and could not differ per task.
- C) A hint inside each `options` entry (object form). Every consumer of `options` (builder, import, markers, feature sheet) would have to accept two shapes; a parallel `option_hints` map changes none of them.

## Chosen (provisional)
A. One evaluation in core (`core.form`, F5/R1) serves the device renderer and the plan (`invalid_input` for an answer outside the offer). `FieldState.options` carries `{ key, hint? }` so an assistant (H4) or a QGIS form (H6) sees the same filtered list. An answer the filter removes is cleared (ODK); the participant form clears it at once and, when a stored value would be erased, asks first with the "Felder werden geleert" dialog (owner Q5). The builder UI (Quellfeld picker, per-value checklist) is a follow-up after WP-381; docs/05 gives the expression shape it will write. The seam to move the filter or the hints: `FieldState.options` is the only thing renderers read.

## Cost to change later
now: one schema key each on `FormFieldSchema` and `PropertySchema`, `core/form`, one problem code · after the build: moving the key is a template migration of the paths (`choice_filter` and `option_hints` are new, so no data migration).
