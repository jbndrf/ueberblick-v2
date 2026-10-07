# B-014 A feature's display name is its first required text property
priority: medium   status: provisional
date: 2026-10-01   lead: b   work packages: WP-593   touches: packages/core (locale/display-name), packages/ui (feature list, feature sheet), docs/05, docs/user/participant

## Context
Lists, the feature sheet title and relation links need a human name for a feature. docs/05 has no way to declare which property names a feature, and R4 forbids a built-in `name` property. WP-593 first chose "the first non-empty `text`/`localized_text` property in declaration order". In the golden tree cadastre that is `baum.befund` (a free-text finding), or else `intern_notiz` (an internal note). Neither is a name, and an internal note must not be a title.

## Options
- A) First non-empty text or localized_text property in declaration order.
- B) First **required** `text` or `localized_text` property in declaration order. Without one, the type label plus `#` and the last 4 id characters ("Baum #4f2a").
- C) A declared type-level `title` (a CEL expression over the feature's properties) in the config format.

## Chosen (provisional)
B. It needs no schema change and gives the right answer in the golden corpus: `flaeche.name` and `baumart.name_de`, while `baum` falls back to "Baum #4f2a". It never picks optional free-text fields such as findings or notes. The seam is `displayName(type, feature, locales)` in `@ueberblick/core/locale`, which every caller uses (R1). C later replaces the rule inside that one function, plus one optional key in the type schema. C also serves H4 (AI assistants) and H3 (role apps), which need the same name.

## Cost to change later
now: low · after the build: low (one function; C is additive).
