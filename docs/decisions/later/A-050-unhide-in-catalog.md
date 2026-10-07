# A-050 Hidden template elements come back from the catalog ("Einblenden")
priority: low        status: provisional
date: 2026-10-04   lead: a   work packages: WP-445, WP-452   touches: R15, H3

## Context
WP-445 hides a template task, rule or field ("Ausblenden", a `hide` op). Hidden, it vanished from every builder surface; the only way back was typing YAML in the Code view.

## Options
- A) The catalog inventories (Aufgaben, Regeln, Feldbibliothek) list the hidden template elements at the end, greyed, with "Einblenden" (the `unhide` op). No new screen.
- B) A separate "Ausgeblendet" screen or dialog. New screen: needs the owner.
- C) Code view only (status quo).

## Chosen (provisional)
A, because the inventories are where the admin looks for tasks, rules and fields, it adds a row and not a screen, and it is one op. The seam: `buildInventory` returns `hiddenTasks`, `hiddenRules`, `hiddenFields` apart from the visible lists, so another place (B) can read the same rows.

## Cost to change later
now: one component (`catalog/HiddenRow.svelte`) and three inventory fields · after the build: delete them, or move the rows into a dialog; no data change.
