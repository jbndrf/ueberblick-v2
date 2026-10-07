# B-013 A stored project file is self-contained: `$ref` assets are embedded once, at ingestion
priority: medium   status: provisional
date: 2026-09-30   lead: b   work packages: WP-577, WP-550   touches: packages/core (compile), packages/server (deploy, templates), packages/builder (doc), apps/migrate, docs/05

## Context
Golden templates reference layer styles as `$ref` files next to the project file. In WP-577 `compile` resolves them through an `AssetResolver` port and embeds the resolved JSON into `CompiledConfig.file`. About 15 compile callers (deploy, template publish, the builder doc, migrate, test worlds) have no project bundle to resolve from, and no bundle store exists.

## Options
- A) Embed at ingestion. Only the places that read a template from a directory, or from another external source (golden fixture loading, migrate convert, a template import), pass a real resolver. From then on the stored and exchanged file is the embedded `compiled.file`, which has no `$ref`. Every other caller passes the explicit `NO_ASSETS` resolver, which refuses any `$ref` with `asset_unresolved`. The resolver parameter is required; there is no silent default (R11).
- B) Add an asset bundle store (a template version holds file plus assets), and make every compile site resolve against it.
- C) Keep `$ref` unresolved and resolve at render time on the device (the WP-550 `style_unresolved` path).

## Chosen (provisional)
A. It is the cheapest to undo, needs no new table, and keeps one definition of the compiled state. Deploy and `versions.ts` already recompile from the stored embedded file. The seam is the `AssetResolver` port: B later means one resolver backed by a store, passed at the same call sites. Large assets (H1 3D models, H5 external GIS layers) will need B or a URL-reference shape instead of embedding; the per-renderer shape table in `assets.ts` is where that slot goes (R13). C is rejected because a device should never see an unresolvable config. Once WP-577 lands, WP-550's app-side `style_unresolved` and `tool_setting_invalid` notices become unreachable for any accepted config, and a follow-up removes them.

## Cost to change later
now: low · after the build: medium (the stored files would need re-splitting into file plus assets).
