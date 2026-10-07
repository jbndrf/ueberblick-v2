# A-048 Entity selector: Mehrfachauswahl is `cardinality`, Anzeigefeld is `display_property` on the reference
priority: medium   status: provisional
date: 2026-10-04   lead: a   work packages: WP-443   touches: packages/core (schema/property, form/type, locale/display-name), packages/ui (form), packages/builder (v3/form/entity), apps/web (admin data columns), docs/05, docs/08

## Context
v3's entity selector had "Mehrfachauswahl erlauben" (pick several) and, for a Tabelle, "Anzeigefeld" (which column the picker shows). v4's selector (WP-393) wrote a `reference` or `participant` property without either. B-014 gives every feature one display name, which fits a picker only when the table has a required text. Cardinality existed only on `relations`, not on a picked reference *property*. The first draft of this decision named the key `display`, but `display` is already the read-view object of a property (`display.tab`, `display.row`, WP-659), so the key is `display_property`.

## Options
Mehrfachauswahl:
- A) `cardinality: one|many` on `reference` and `participant` properties, the same key and values as a relation (R1). The value is one id or a list of ids; the engine already folds both (`fold/edges.ts`, `plan/targets.ts`), only the value check, the expression type and the inputs were single-id.
- B) A new property type (`reference_list`). A second type for one idea, a new registry entry in every switch.

Anzeigefeld:
- A) An optional key `display_property` on a reference property naming a property of the target type; pickers and admin cells show it, else B-014's name.
- B) Type-level `title` (B-014 option C): one name everywhere, but no per-picker choice, and a schema key on every type.
- C) None: B-014's name only. Tables without a required text show "Art #4f2a" in pickers.

## Chosen (provisional)
Mehrfachauswahl A, Anzeigefeld A. Both are additive keys, absent means today's behaviour, and removing them later drops the key and nothing else. Compile refuses a `display_property` that is not a property of the target (`dangling_reference`, kind `property_of`). The one function that decides is still `displayName(type, feature, locales, via?)` in `@ueberblick/core/locale`: `via` is the reference property, so the picker, the admin cell and later the sheet ask the same function (R1) and the type-level `title` (B-014 C) can still replace the fallback inside it. In expressions a `many` reference is a list of features and a `many` participant a list of strings (`schema/compile/env.ts`), so rules that read it as one are flagged by compile, not silently wrong.

Many back to one: the stored values of a property that was many are lists, which a one-id property refuses. `breakingChanges` (`template/breaking.ts`) and `diff` (`schema/compile/diff.ts`) report `cardinality` many to one (or removed) as `type_changed` at the property, so the existing deploy path (major version, value move, pinning A-029) covers it; one to many is not breaking. The builder in addition refuses to switch Mehrfachauswahl off while the template the project is built on declares the property many; a property made many in the project's own overlay can be switched back (deploy then flags it).

Wiring: the participant picker (`choicesFor` passes the property to `reader.labelOf(state, locale, via)`) and the admin list API (`GET features` answers `referenceNames`: per reference property the target ids of the returned page and their names, one indexed `id IN (...)` read per 200 distinct ids, O(page), R14) show the Anzeigefeld. Names there use the languages de, en. The Tabellen grid has its own loader and does not show names yet.

## Cost to change later
now: low · after the build: low (two optional keys; `display_property` can move to a type-level `title` by one function change plus a migration of the key).
