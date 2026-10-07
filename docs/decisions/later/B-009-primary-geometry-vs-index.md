# B-009 The declared primary geometry is the map geometry; the spatial index covers every geometry property
priority: medium      status: provisional
date: 2026-09-30   lead: b   work packages: WP-544   touches: R4, F-geo, docs/04, docs/05

## Context
`types.<t>.geometry` names the primary geometry property. The schema says "only the primary one is indexed". The server store (`features.geometry`) instead takes the first geometry property with a value, fold and the store ignore the declared key, and the spatial index (R*Tree, `Facts.near`, the client grid) holds the union bbox of all geometry properties. Derived relations may compare any geometry properties (`predicate(self.<a>, other.<b>)`, docs/05), and their prefilter relies on the index.

## Options
- A) The declared primary geometry is what the store and fold treat as the feature's map geometry (`features.geometry`, map anchor, first-markers). The spatial index keeps the union of all geometry properties, so derived predicates on any geometry property stay prefiltered. Correct the schema description.
- B) Index only the primary geometry and restrict `derive` spatial predicates to primary geometries (a new compile problem).
- C) Keep "first geometry with a value" and drop the `geometry` key.

## Chosen (provisional)
A. It is the smallest change that makes the config key mean something (R4: config declares, the platform does not guess). It also keeps every existing derive valid. Seam: `FoldType.primaryGeometry` is the single source, so B can later narrow the index without touching the adapters.

## Cost to change later
now: low · after the build: medium (stored `features.geometry` would need a recompute on change).
