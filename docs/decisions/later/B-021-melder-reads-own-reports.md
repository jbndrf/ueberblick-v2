# B-021 A Melder reads who reported, and her start screen is her own list
priority: low        status: provisional
date: 2026-10-03   lead: b   work packages: WP-719   touches: R13 (none blocked), H3 role apps

## Context
On the demo a Melder opened an empty map. Template `maengelmelder` hid the property `melder` from the role `melder` (`see: { melder: [sachbearbeiter] }`), so the view `meine_meldungen` (`self.melder == actor.id`) matched nothing (a filter reading an unreadable property matches nothing, `filters/evaluate.ts`). Her `home` was the view `melden` with `filter: "false"`.

## Options
- A) `see: { melder: [melder, sachbearbeiter] }` and `home: meine_meldungen`. `visible_when` already limits a Melder to her own rows, so reading her own id leaks nothing. The Handwerker still does not see who reported.
- B) An implicit self-read rule in the engine. Invents a rule; deny-by-default stays clean without it.
- C) Filter on `self.$created_by == actor.id` instead. Possible later, needs no engine work.

## Chosen (provisional)
A, edited in place in `fixtures/golden/templates/maengelmelder/1.0.0.yaml` (a golden fixture, not a published version, so no version policy applies). The view `melden` stays: `scenarios/i18n/localized_labels_fallback.yaml` resolves `views.melden.label`, and that file is outside this work package. The seam for C is the view's `filter`.

## Cost to change later
now: one line each in the template. After the build: the same, plus a template minor version for a published template (the permission widening is non-breaking).
