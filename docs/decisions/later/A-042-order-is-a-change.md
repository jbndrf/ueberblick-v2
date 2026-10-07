# A-042 An order change is a change
priority: medium        status: provisional
date: 2026-10-03   lead: a   work packages: WP-401   touches: H3, R3, R13

## Context
WP-382 found that a draft which only reorders (properties, form fields, Tabelle columns) showed as clean in the publish bar. `diff` walked object keys sorted and `contentHash` is RFC 8785 JSON, which sorts keys, so key order was in neither. The new order went live with the next real change.

## Options
- A) Order is a change: a registry list of ordered maps (`ORDERED_MAPS`); `diff` reports one `order_changed` entry per map whose shared keys changed order; the compile hash also covers the key lists of those maps.
- B) Order is never a change (status quo). Participants see the new order late; the publish bar cannot offer it.
- C) Hash and diff every object's key order. It would also report order in objects where it means nothing (a property's own keys) and break when a parse normalises key order.

## Chosen (provisional)
A. `order_changed` is non-breaking: `breakingChanges` is untouched, reordering never moves a value. Keys added or removed are not an order change: only the order of the keys both files share counts. The hash input is `{ file, order }` where `order` is `orderSignature(file)`; equal content in equal order keeps the same hash. The list covers every map the app reads in file order: also `roles.*.app.tools` (Werkzeuge sheet), top-level `tools` (its fallback), `roles.*.app.filter_presets` (Ansichten tab), `rules` (firing order) and `map.packs` (settings list, server store; lead decision, review round 1). Seam: a new ordered map is one entry in `ORDERED_MAPS` (`packages/core/src/registry/compile.ts`). Arrays (`map.order`, `display.row` numbers) were already compared by value.

## Cost to change later
Hashes of existing deployed versions change once (pre-release, no shim): the next deploy of an unchanged file creates one new version. Removing the rule is one registry list and one line in `compile`.
