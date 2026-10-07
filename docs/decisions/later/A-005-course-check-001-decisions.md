# A-005 Key paths, stored compiled config, reserved words, sync forward-compat (course check 001)
priority: high        status: provisional
date: 2026-09-29   lead: a   work packages: WP-012, WP-013, WP-020.2, WP-102.1, WP-010.1   touches: O11, F13, H1–H4, budget (participant shell)

## Context
Course check 001 (`reviews/course/001-2026-09-29.md`) found shapes that were about to be coded without a decision.

## Chosen (provisional)
1. **Key path grammar.** Dot-separated segments. A segment matching `^[a-z][a-z0-9_]*$` is written bare; any other segment is a JSON string in brackets: `views.karte.layers.baeume.style["circle-color"]`, `label["en-GB"]`. **Lists are atomic**: an overlay overrides a whole list (`then`, `sort`, `lock`). Upgrades that touch the same list conflict and the builder resolves them. **H3 cost, avoided where it matters most:** role app `views`, `tools` and `shortcuts` become keyed maps (`views: { karte: {}, meine_aufgaben: {} }`, order = authored order, values hold per-role settings), so municipal customisation adds or hides single entries. The escape route for other lists is the same: a keyed map with an optional `order`. Rejected for v1: element addressing (`[+]`, indices) — unstable under upgrades. Undo: medium (overlay migration); element addressing can be added later without breaking bracket paths.
2. **What is stored.** `config_versions.compiled` holds `CompiledConfigData`: plain JSON with `format` (a version constant), the effective file, its `hash`, and every expression as `{path, source, ast, types}` (AST JSON plus the checked type of every node in pre-order — one typing, a few kB). Runtimes `hydrate()` it without Zod, `compile()` or the checker, which keeps them out of the participant shell (≤ 250 KB). On the server it is a cache: if `format` is older than the running core, the server recompiles from the stored effective file. A device cannot recompile: for queued runs against a version whose `format` it cannot read, it refetches that version from the server (docs/07). `ast.ts` is thereby a persisted format; a test pins that it cannot change without a `COMPILED_FORMAT` bump. Undo: low (cache).
3. **Hash** = SHA-256 over RFC 8785 (JCS) canonical JSON of the effective file.
4. **Platform keywords get a sigil**: in key positions they are written `$map`, `$none`, `$all` (and later e.g. `$team`). Keys can never start with `$`, so a new keyword can never collide with an existing project (a reserve list only protects today's words). `RESERVED_KEYS` keeps only the rule-language names, literals and `in`, rejected as keys by `compile` (`reserved_key`).
5. **Sync forward compatibility.** Within a protocol major, decoders ignore unknown columns; only removals or changed meaning bump the major (offline devices with queues must keep working across server updates).
6. **Parser limits.** Flat left-associative chains do not count towards depth; depth counts nesting. Two limit sets: config (generous) and untrusted (assistant/CQL2 input). History functions keep the quoted form `last('stage', 3)`, but `check` validates the string against the type's properties.

## Seam
`CompiledConfigData.format`, `SYNC_PROTOCOL_VERSION`, `schema_version` + `migrate(file)`, `RESERVED_KEYS`.

## Cost to change later
1 is the costliest after the build (every stored overlay); 2–6 are local.

## Addendum (WP-122, 2026-09-29)
7. **Geometry is a port of evaluation.** `EvalContext.geo` (required) carries the `Geo` implementation; `expr` never imports the JSTS engine. Participant code loads `@ueberblick/core/geo` lazily (JSTS + proj4 ≈ 127 KB gz) and passes it in; the participant core share without geo measured ≈ 14 KB gz (vs 140 KB with geo). Required, not optional, so a missing engine cannot silently make spatial conditions false.
8. **Subpath exports, full root.** `@ueberblick/core` keeps exporting everything (server, builder, tests); lean subpaths (`/hydrate`, `/expr`, `/sync`, `/fold`, `/geo`, …) are what participant-facing code must import. *Correction (course check 003): the depcruise rule did not exist yet; WP-122.1 adds it and migrates the existing root imports.* Cheapest to undo; no mass migration.
