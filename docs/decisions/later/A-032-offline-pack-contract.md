# A-032 Offline packs (PMTiles): definition, build, manifest, download
priority: high        status: provisional contract (lead-a); owner answered P5 = (c) on 2026-10-04
date: 2026-10-01   lead: a (server and admin side), b (device side, WP-662)   touches: docs/05 / docs/07 / docs/09 / docs/12

## Context
rebuild.md step 5 names offline packs (PMTiles) as lead-a's admin side and lead-b's device side. docs/09 already fixes the format ("an offline pack is PMTiles plus a JSON manifest"), and docs/03 already fixes the device store (OPFS).

v3's admin "Offline-Pakete" works like this (`a2-settings-data.md:76,104`, `OfflinePacksSection.svelte:295-552`):
- each pack has a name, a status, a zoom range, a tile count, a size and "Sichtbar für Rollen";
- a create dialog has a RegionSelector, shows the estimated tile count, and picks layers and roles;
- the create button is disabled while the project has no map layers.

Today nothing builds, stores or serves packs. lead-b's WP-650 (the Settings "Offline" tab) is blocked on that.

## Chosen (provisional)
1. **The definition is config.** It lives in the project file next to the map layers it packs, goes through the draft and Veröffentlichen (Q16), and can ship with a template:
   ```yaml
   map:
     packs:
       innenstadt:
         label: { de: Innenstadt }
         bounds: [7.08, 50.70, 7.14, 50.75]   # [west, south, east, north], WGS84
         min_zoom: 12
         max_zoom: 17
         layers: [osm, flur]                  # map.layers keys
         roles: [kontrolle]                   # audience; absent = everyone who sees the layers
   ```
   - The checker refuses unknown layers, `min_zoom > max_zoom`, a zoom outside the layer's range, and a tile estimate above a registry limit (`PACK_LIMITS`: max tiles and max bytes per pack, R6).
   - It also refuses layers that cannot be packed. `geojson` layers are carried as data, not tiles, and `wms` needs the server to render tiles, so both are out for now. Only `xyz`, `pmtiles` and `preset` are allowed.
   - The rule language is not involved; `roles` is an audience like the other `roles:` lists.
2. **The build is a server job, keyed by content.**
   - `pack_hash = sha256(canonical(pack definition) + for each layer: source canonical form)`. A deploy that leaves a pack's hash unchanged reuses the built files; nothing is rebuilt.
   - There is one PMTiles file per (pack, layer), because layers differ in tile type (raster or vector). `pmtiles` sources are extracted by range (bounds × zooms); `xyz`/`preset` sources are fetched tile by tile with a polite rate limit and an identifying User-Agent. See P5.
   - Build state per (project, pack_hash) is `queued | building | ready | failed(reason)`, with progress `{ tiles_done, tiles_total, bytes }`.
   - Files go to the server's blob directory, under `packs/<project>/<pack_hash>/<layer>.pmtiles`. Old hashes are deleted once no deployed or pinned version references them.
3. **Manifest (device):** `GET /api/p/<project>/packs` (participant auth, filtered by `roles` and by the layers' own audience) returns:
   ```json
   { "packs": [ { "key": "innenstadt", "label": "Innenstadt", "hash": "<pack_hash>",
       "bounds": [w,s,e,n], "min_zoom": 12, "max_zoom": 17,
       "layers": [ { "layer": "osm", "tile_type": "raster", "url": "/api/p/<project>/packs/<hash>/osm.pmtiles",
                     "bytes": 123456, "sha256": "…", "max_zoom": 17, "tiles": 4821 } ],
       "bytes": 234567, "built_at": "…" } ] }
   ```
   - Per layer, `max_zoom` is the layer's own built maximum (`min(pack.max_zoom, layer source max)`, may be below the pack's; the device overzooms above it), and `tiles` is the tile count in that file (lead-b request, 2026-10-01).
   - Only packs in state `ready` are listed. The device diffs by `hash` and per-layer `sha256`, and downloads only what changed.
4. **Download:** `GET /api/p/<project>/packs/<hash>/<layer>.pmtiles`.
   - Participant auth, with the same audience check as the manifest.
   - Supports HTTP Range (PMTiles readers need it, and resume works on flaky networks).
   - Sets `ETag = sha256` and `Cache-Control: private, immutable`, since the URL changes with the hash.
5. **Admin:** `GET /api/admin/p/<project>/packs` returns definitions with build state, progress, tile estimate and size. `POST …/packs/<key>/rebuild` retries a failed build. Create, edit and delete are draft edits through Doc ops (as WP-343/346), never a second write path.
6. **Device side (lead-b, WP-662, against this contract):**
   - OPFS store keyed by `hash/layer`, and a PMTiles reader;
   - a MapLibre protocol that tries the pack, then the network, then overzoom (p2-map G7/#14);
   - a progress signal and offline thumbnails.

## Seams (R13)
- `MAP_SOURCE_TYPES` gets a `packable` flag in the registry. WMS packing (server-rendered tiles) or vector extracts can be added later by flipping it, with no shape change.
- 3D/BIM (H1) can add `kind: terrain` layers to the same pack.
- Dispatch (H2) can define per-role packs.
- The manifest is versioned by its `hash`, so the protocol can grow fields without a version bump.

## Rejected
- **Packs as admin data outside config.** That would not be versioned, could not come from a template, and would be a second settings store (R1).
- **One PMTiles file for all layers.** Raster and vector tiles cannot share a file.
- **Device-side tile scraping.** It is slow, not resumable, and multiplies the load on the tile provider.

## Owner question (QUESTIONS.md P5)
Bulk-downloading OpenStreetMap's public tiles breaks the OSMF tile usage policy, even when polite. Options:
- **(a)** Packs only from `pmtiles` sources the project hosts, such as a Protomaps extract (recommended).
- **(b)** A licensed tile provider with a key.
- **(c)** Allow `xyz` with a rate limit and a project-level acknowledgement.

The contract does not change; the choice only sets which source types are `packable`.

**Answered 2026-10-04: (c).** The owner: "its a one time download after that it will be on the cache. thats fine i guess." `xyz` and `preset` sources are packable; their tiles are fetched through the server tile cache proxy (each tile from the provider once), with cache misses rate-limited by the shared host limiter (WP-369, verified by WP-470).

## Work packages
- lead-a:
  - WP-349: config schema, checker and estimate;
  - WP-350: build job, store and admin endpoint;
  - WP-351: manifest and download endpoints, plus a bench;
  - S3: the v3 "Offline-Pakete" admin section.
- lead-b: WP-662 (device).
