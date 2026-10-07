# server/io: import and GeoPackage export (WP-111)

Contract and rules: `contract.ts`. User page: `docs/user/admin/how-to/import-export.md`.

```
file --read-csv | read-geojson | read-gpkg--> ImportRow (lazy) --planRows--> Run[] --Store.submitBatch / submit
Store + actor + sync.visible --buildGpkg / exportGpkg--> GeoPackage bytes
```

- **Entry points.** `importFile(store, source, mapping, deps, { mode })` (get `store` from `projectStoresFor(runtime)` so hooks, timers and the doorbell fire). `planImport` is the same without writing; `planRows` takes rows already read: the seam for the v3 converter (WP-301), no file needed.
- **Role cells.** `coerce("role", cell, { roles, cardinality })` takes a role key or label (any language), `|`-split for cardinality many; an unknown role is a row problem like the plan refusal.
- **No direct writes (R3).** Every row is a run of the mapped creating task, actor kind `import` (the caller passes the actor; a task's `when` still applies, so it needs the roles the task asks for).
- **Geometry.** `core.geo`: `toWgs84` (Z kept), `normalise`, `validate`, then `repair` if needed, all in the exported `prepareGeometry(geo, g, { sourceCrs, kind?, repair? })` (`geometry.ts`; `repair` defaults to true; the v3 migration calls the same function); a geometry kind other than the property's `geometry_type` is a problem. WKB and the GeoPackage blob are in `wkb.ts` (Z read and written). Predicates are not involved.
- **Memory.** CSV is read record by record; GeoPackage is read row by row from a temporary copy (a path avoids loading the file). GeoJSON is parsed whole (`JSON.parse`); a streaming parser is a later step if a file needs it. Runs are held in memory (10k: about 75 MB extra).
- **Export.** One feature table per type, built in a temporary file (`_fid`, `_id` = feature id, geometry column named like the property, one column per readable property; booleans 0/1, other structured values JSON text) and streamed in 64 KiB chunks. Rows come only through `SyncService.visible` and columns through `Perms.readable`; there is no second filter (R1).
- **Registries** `IMPORT_FORMATS`, `IMPORT_MODES`, `IMPORT_PROBLEM_CODES` live in `registry.ts` until moved into core.
- **HTTP, constants, replace (WP-363).** `submitPlan` submits a plan in steps (atomic: one `submitBatch`, optionally with `before` runs; skip: `IMPORT_BATCH` per step). `mapping.constants` turns rows into `$import` runs. The endpoints, the job table and replace are in `http/admin-import` (docs/03).
- **Not built.** Shapefile, WKT columns in CSV, a screen (WP-364), a stored CRS confirmation.
- **Project ZIP (WP-384).** `archive/` holds the project ZIP: `zip.ts` (streaming codec on `node:zlib`), `manifest.ts` (format, entries), `export-zip.ts` (`exportArchive`: project file, folded features per Objektart, blobs), `import-zip.ts` (`importArchive`: check, create, roster, deploy, blobs, one `$seed` run per feature), `roster.ts` and `import-roster.ts` (the participants with their login tokens, WP-432, A-046: the archive is sensitive) and `identity.ts`. The endpoints are `http/admin-export`; the design is in docs/03 "Project ZIP".
