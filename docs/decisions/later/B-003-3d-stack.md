# B-003 3D stack: OGC 3D Tiles + MapLibre custom layer with three.js (O13)
priority: high        status: provisional
date: 2026-09-29   lead: b   work packages: WP-500, WP-521   touches: H1, O13, R14, schema (views)

## Context
H1 requires room for CAD/BIM, city models and scans next to 2D features on a phone. O13 asked for a spike before Phase 4 ends. WP-500 measured three stacks next to a MapLibre basemap (`docs/research/spike-3d.md`; software GL, 4× CPU throttle, one small tileset).

## Options
- A) MapLibre custom layer + three.js + 3d-tiles-renderer: +172 KB gz lazy chunk, first frame 905 ms (2349 ms on 4 Mbit/s), 6 MB heap. Shares the 2D map's camera.
- B) deck.gl Tile3DLayer: +352 KB, 1169 ms (2808 ms), 8.3 MB. Breaks on MapLibre 6.x today.
- C) CesiumJS: +1038 KB plus ~1.3 MB runtime, 1958 ms (6573 ms), 17.3 MB. Own canvas; strongest for globe-scale and I3S.

## Chosen (provisional)
Format: OGC 3D Tiles 1.1 with glTF content; IFC converted server-side ahead of time. Renderer: A as the first `3d` entry in the renderer registry. The seam: the renderer registry and `ViewRenderer` interface (WP-521, `packages/ui/src/map/contract.ts`); B and C can be added as further registry entries. Schema additions proposed for lead-a before the view schema freezes: `source` as a union of feature type and `{ asset }` (base URL/blob prefix), optional view `camera`, and a host mode (`interleaved` | `own-canvas`) per renderer entry. Offline: prefix-scoped tile cache with a manifest.

## Cost to change later
now: low (nothing built) · after the build: medium (one renderer module; the view schema additions stay). Risks: untested on large models and real GPUs; MapLibre major upgrades must be checked against the 3D renderer.
