# core.geo

Geometry for the whole platform (F11, decision 0013). Entry: `createGeo(engine?)` from `./index`; the contract is `contract.ts`.

| File                      | What                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crs.ts`                  | `toWgs84` (proj4, inline definitions for EPSG:4326/4258/25832/25833/31466-31469, 7 decimals) `fromWgs84` (the inverse for `crs=` / `bbox-crs` at the OGC API: same definitions, 7 decimals geographic, millimetres projected, Z untouched; exported from `@ueberblick/core/geo`) and `guessCrs` (by coordinate magnitude; the user confirms) |
| `normalise.ts`            | 7 decimals, closed rings, exterior counter-clockwise, holes clockwise; idempotent                                                                                                                                                                                                                                                            |
| `validate.ts`             | `validate` (registry issue codes plus a JSON-pointer path) and `repair`                                                                                                                                                                                                                                                                      |
| `derive.ts`, `measure.ts` | bbox, point on surface (polylabel, verified, with fallbacks), area-weighted centroid, geodesic area (WGS84 authalic) and length                                                                                                                                                                                                              |
| `engine-jsts.ts`          | the only file that knows JSTS: predicates, validity, make-valid. `createJstsEngine({ prepared })`                                                                                                                                                                                                                                            |
| `spatial-index.ts`        | packed bbox R-tree in front of the engine (`geo.index`)                                                                                                                                                                                                                                                                                      |
| `bbox.ts`                 | `bboxOf`, `bboxOfCached` (per geometry object, for candidates a plan meets again and again), `unionBbox`, `bboxIntersects`; engine-free (`@ueberblick/core/geo/bbox`)                                                                                                                                                                        |
| `fixtures.ts`             | the fixture corpus the specs and benchmarks share                                                                                                                                                                                                                                                                                            |

## Rules of the module

- **Z is never dropped** (H1). Reprojection and normalisation pass it through. Derived 2D values ignore it. A `Point` derives to itself, Z included. Repair of an invalid area may create new nodes; those have no Z.
- `validate().valid` ignores `wrong_winding` (normalise fixes it silently), but the issue is still listed.
- `derive` throws on an empty geometry; `validate` reports `empty` first.
- `index.query('disjoint', probe)` returns everything that does not touch the probe, so it is linear in the index size. Every other predicate is bbox-pruned.
- `index.nearest(probe)` returns the entry with the least `distanceM` (ties: the earlier source entry). It visits tree nodes and entries by bbox lower-bound distance and stops once the best exact distance is below the next bound, so a tap on 2k polygons measures a handful of them (0.12 ms raw, brute force 6.7 ms). Exact distances still come from `distance.ts`. Z is ignored.
- The engine is swappable (`GeoEngine`). Point-in-area tests use JSTS's indexed point locator instead of the general relate path (5x faster); `createJstsEngine({ prepared: false })` is the reference path for cross-checks.
- `Geo.test` answers Point vs (Multi)Polygon for `intersects`, `within` and `contains` itself (`point-in-area.ts`: ray casting with holes) when the point is clearly inside or outside; a point on or within rounding distance of an edge goes to the engine, so boundary semantics are always JSTS's. `point-in-area.spec.ts` proves agreement with the plain JSTS path (property test).
- JSTS's `PreparedPolygon` is broken in 2.12.1 (its constructor crashes), so it is not used.

## O6: JSTS or GEOS-wasm (recommendation: JSTS)

Measured on this machine (Node 22), 2026-09-29:

|                                                                                  | JSTS 2.12                        | GEOS-wasm 3.1.1                          |
| -------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------- |
| Predicate parity, 14 geometries x 14 x 10 predicates                             | 1960 / 1960 identical            | (same)                                   |
| 540k point-in-polygon tests (60k points, 9 candidate polygons each, 2k polygons) | 298 ms                           | 248 ms                                   |
| 60k queries through `geo.index`, plain JS                                        | 103 ms                           | not built                                |
| Size                                                                             | 500 kB (110 kB gzipped), pure JS | 2.6 MB JS with the wasm inside           |
| Licence                                                                          | EDL-1.0 / EPL-1.0                | LGPL-3.0-or-later                        |
| API                                                                              | object based, typed loosely      | raw C API: malloc, pointers, manual free |
| Async init                                                                       | none                             | yes (`await initGeos()`)                 |

Both engines agree on every predicate and the speed is equal within 20%, so the deciding factors are size, synchronous use everywhere (rules run in the fold), no manual memory and the licence. JSTS stays the default. `GeoEngine` keeps GEOS-wasm possible if a later need (huge polygon overlays, buffers) shows up. The benchmark script is in the WP-030 log.

## Distance

`geo.distanceM(a, b)` is the shortest distance in metres between two geometries, 0 when they intersect (the engine decides that). `geo.dwithin(a, b, metres)` is `distanceM(a, b) <= metres`. Both are what the rule-language `distance` and `dwithin` call. Point pairs use haversine, point-to-segment a local equirectangular frame around the probe; both are within 0.5 % of Karney/Vincenty at German distances (tested against a Vincenty reference). Z is ignored (H1: the metric is 2D; storage keeps Z). An empty geometry throws. There is no SQL form; `toSql` keeps `distance` unsupported.

## Benchmarks

`npm test -- -c bench/geo/vitest.config.ts --silent=false` prints medians and fails when a budget is missed.
