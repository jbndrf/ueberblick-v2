# 0013 · Geometry: WGS84 storage, source CRS on import, vetted predicates

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** v3 assumed WGS84, used a vertex-mean centroid and had no predicates.
- **Decision:** RFC 7946 storage; `source_crs` required on import (proj4); `core.geo` derives bbox, point-on-surface, centroid and area in the fold; predicates come from JSTS or GEOS-wasm, pinned by a fixture corpus.
- **Rejected:** Own predicate code.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
