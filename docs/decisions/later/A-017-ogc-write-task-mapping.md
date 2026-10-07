# A-017 OGC API writes: which task a write runs, and DELETE
priority: medium        status: provisional
date: 2026-09-30   lead: a   work packages: WP-110   touches: docs/11 external GIS, R3, A-008

## Context
WP-110 (OGC API Features, part 4 transactions) must turn an HTTP create or update from a GIS client into a run (R3). The project file has no link from "an OGC write on type T" to a task. DELETE cannot be a run yet: no task can set `$deleted`, and `plan` has no delete path.

## Options
- A) Infer the task: the first task in config order that creates T (create) or whose form covers the changed properties (update).
- B) Explicit only: `?task=<key>` is required.
- C) Explicit `?task=` if given. Otherwise the unique candidate task (creates T, or covers the changed properties) that the actor may run. If none or several match, answer 422 and list the candidates (chosen).
- D) A config-declared mapping per type (for example `ogc: { create: task, update: task }`), which needs a schema change.

## Chosen (provisional)
C. Declaring intent is not a guess: an unambiguous write works from stock clients (QGIS cannot add query parameters easily), and an ambiguous one fails loudly instead of silently running whichever task comes first. Only admin principals write (A-008); the actor kind is `admin`. DELETE answers 422 "no task deletes" until core has a delete effect (lead-b follow-up). The seam: a `resolveWriteTask(config, type, change, actor, hint?)` port inside `http/ogc`, so D replaces one function.

## Cost to change later
small: the resolver function plus its tests; D also needs a schema key (a template overlay change, `open.md` if it touches the file format).
