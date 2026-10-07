# B-024 The configured look is the single source of a feature's marker and area colour
priority: medium        status: provisional
date: 2026-10-03   lead: b   work packages: WP-746   touches: H1 (renderer style stays open)

## Context
Owner report: map markers differ from the icons in the filter sheet. The demo templates' view styles (`karte`, `lagekarte`, `antraege`) added circle and fill layers after `ub-single`, covering the icons and using other area colours. v3 had no such thing: markers came from the workflow icons only (`reference/src/lib/components/map/map-icons.ts`); its map overlays (`map-overlays.ts`) draw measuring lines, not features.

## Options
- A) Demo styles stop restyling features of types that have a look; a golden spec guards it. Cheap, no renderer change.
- B) The renderer ignores feature-restyling layers of types that have a look. Hides the cause; a style silently does nothing.

## Chosen (provisional)
A. The type's look (`marker`, `classify`) is the one source (R1). Styles may add context (labels, extra layers). Guard: `apps/web/src/lib/participant/golden-looks.spec.ts`. Seam for B: `packages/ui/src/map/maplibre/style.ts` `resolveLayers` could drop such layers for styled types.

## Cost to change later
now: re-add styles to the templates. after the build: a renderer rule in `resolveLayers` plus a publish warning.
