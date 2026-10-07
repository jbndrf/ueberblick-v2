# A-041 Removing or changing a tool is not a breaking change
priority: low        status: provisional
date: 2026-10-03   lead: a   work packages: WP-391   touches: H3 / R13

## Context
`template.breakingChanges` treated `tools` like a data section. Switching the chat off in Projekteinstellungen removes `tools.chat`; once published, the deploy was refused with `mapping_required` and the admin had to map (discard) it on Versionen, for a tool that owns no Objekt data.

## Options
- A) Keep `tools` breaking: every tool removal needs a mapping; no data is at stake, so the mapping is meaningless.
- B) `tools` is not breaking: a tool holds no Objekt values; a removed or changed tool config needs no mapping.

## Chosen (provisional)
B. Chat messages live in their own table, which a config change does not touch. The seam: a tool that later stores data in Objekt properties declares that, and the check then applies to it (`SECTIONS` in `packages/core/src/template/breaking.ts`). Roles' `app.tools` entries were never checked.

## Cost to change later
now: one line in `breaking.ts`, its spec and docs/05 · after the build: the same; no data migration.
