# B-002 Geometry predicate engine: JSTS (O6)
priority: low        status: provisional
date: 2026-09-29   lead: b   work packages: WP-030   touches: O6, H1, R14

## Context
Decision 0013 requires vetted predicates from JSTS or GEOS-wasm. WP-030 compared both on a parity corpus.

## Options
- A) JSTS: pure JS, synchronous, ~110 kB gz, EPL/EDL. 1960/1960 predicate results equal to GEOS; 540k point-in-polygon tests 298 ms.
- B) GEOS-wasm 3.1.1: 248 ms for the same tests, 2.6 MB, async init, raw pointer API, LGPL.

## Chosen (provisional)
A, the default in `open.md`, confirmed by the numbers. Seam: the `GeoEngine` interface in `packages/core/src/geo/contract.ts`; `createGeo(engine)` accepts another backend. Known gaps: JSTS has no GeometryFixer (repair is our own polygonize-and-fill), PreparedPolygon crashes in 2.12.1 (IndexedPointInAreaLocator used instead).

## Cost to change later
now: low · after the build: low (write a GEOS `GeoEngine`, rerun the parity corpus; async init at app start)
