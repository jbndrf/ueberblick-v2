# A-011 Builder drafts: one shared draft per project, compare-and-swap on a revision
priority: medium        status: provisional
date: 2026-09-29   lead: a   work packages: WP-212, WP-213   touches: H4 (AI assistants), H5, O10, R13

## Context
WP-212 built the builder shell, but nothing persists an overlay being edited. `config_versions.status = 'draft'` needs a compiled file, and a draft in progress often does not compile. `Doc.saveIf(expected)` already refuses a stale revision.

## Options
- A) One working draft per project in the project DB (`builder_draft`: template, template_version, overlay text, revision, updated_by, updated_at); writes are compare-and-swap on `revision`; a stale write answers 409 with the current draft (chosen).
- B) Per-account drafts or named branches, merged at deploy.
- C) Real-time co-editing (CRDT) — ruled out by CLAUDE.md.

## Chosen (provisional)
A, cheapest to undo and enough for small admin teams; assistants (H4) and the MCP server (WP-211) write through the same endpoint and get the same 409. The seam: a `DraftStore` port (`get`, `putIf(revision)`) in `packages/server/src/builder-draft/`, so B is a key change (project → project+name) plus a picker.

## Cost to change later
small: add a `name` column, a list endpoint and a picker in the shell; data migration trivial (existing row becomes `main`).
