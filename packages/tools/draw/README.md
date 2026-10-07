# @ueberblick/tool-draw

The `draw` field tool (WP-551, decision 0017; reduced in WP-635). A `field` tool for `geometry` properties, selected in a form with `tool: draw`.

**Drawing is not done here.** A line or an area is drawn on the live MapLibre map (`DrawOnMap` and the draw controller in `packages/ui/src/map/draw`, v3's `geometry-draw-tool.svelte`), because a sketch without the basemap cannot place a hedge. The old SVG sketch (canvas, local projection, per-field session) was removed in WP-635 (R11).

What this tool does: it shows what the stored value is in the field slot ("Fläche: 2 Teil(e), 8 Punkte"), or says it is drawn on the map when there is none. It never produces a value. `summarise(value)` counts kind, parts and positions of a point, line, area or their Multi* forms.

## Use

The app gives the host a lazy loader: `draw: () => import('@ueberblick/tool-draw').then((m) => m.drawTool)`. It takes no options.

Strings (de, en) are in the tool's own Paraglide catalogue, `messages/{de,en}.json` (keys `draw_*`).

## Tests

`npm test -- packages/tools/draw`. The drawing itself is tested in `packages/ui/src/map/draw` (session, geometry, validity, controller), `apps/web/src/lib/participant/sheets/create/DrawOnMap.ui.spec.ts` (the + flow) and the component e2e `packages/ui/src/map/draw/e2e` (real MapLibre, phone and desktop).
