# Import and export data

Import creates features from a file; export writes features to a GeoPackage. Import has an endpoint (for advanced users and tools such as QGIS); the screens are two wizards: "Import CSV" on a feature type's data page (see *Viewing the data of a feature type*) and "Import GeoJSON" in the sidebar, which creates a new feature type; the API also takes GeoPackage. Export is on the Projects page: **Export GeoPackage** and **Export data (CSV)** in the ⋮ menu of a project card (see *Create a project*), and the same as endpoints.

## Import
Formats: **CSV**, **GeoJSON** and **GeoPackage**. An import is a set of runs of a task that creates the feature, with the actor `import`. The same rules, required values and automations apply as when someone records a feature by hand, and every run appears in the feature's history.

**Mapping.** You name the task and map each form field to a column of the file. For CSV you also name the x, y and optional z (height) columns. Decimal commas and semicolons are detected. Text is stored in Unicode form NFC, so `Ä` is always the same character.

**Role columns.** A column for a property of type "role" may hold the role key or the role's label (several separated by `|` when the property allows many). An unknown role makes that row a problem.

**Roles.** The import actor needs the roles the task's `when` asks for; otherwise the task refuses.

**Coordinate system.** The file must state its coordinate system or the import is refused (`crs_undeclared`). GeoPackage and GeoJSON with a `crs` member carry it, a GeoJSON without a `crs` member is WGS84 (RFC 7946), a declared system that is not supported is refused; for CSV you choose it (for example EPSG:25832). Coordinates are converted to WGS84; the height is kept unchanged. If the converted coordinates fall off the globe, the wrong system was chosen and the row is reported.

**When a row is invalid** there are two modes:
- **All or nothing** (default): one invalid row refuses the whole file. Nothing is written; the message names the row numbers and the reason. With very many errors the check stops after 1000.
- **Skip invalid rows**: the good rows are imported and the invalid ones are reported with their row number. The runs are then separate, not one unit.

The **row number** counts data rows from 1 (CSV without the header, GeoJSON: the n-th feature, GeoPackage: table order). Row 0 means the whole file.

Limit: 10,000 features take about 2.5 seconds. Shapefiles are not supported.

## Import GeoJSON as a new feature type
In the sidebar, the **+** of the Objektarten group opens the menu with **Import GeoJSON**. The wizard turns a GeoJSON file (FeatureCollection) into a **new feature type** with all the features of the file:
1. **Upload:** choose the file (`.geojson` or `.json`). If it is not valid JSON, not a FeatureCollection or has no features, the reason shows under the field.
2. **Review:** the name of the feature type is filled in (the file name without its extension; you can change it). Below it: the number of features and the geometry type (all types found, for mixed geometries). For every property of the file a row shows the **inferred field type** (Short text, Long text, Number, Whole number, Yes/No, Date, Date and time); the select lets you change it. When in doubt the wizard infers text so nothing is lost; numbers with a leading zero (postcodes) stay text.
3. **Publish and import:** the feature type is first created in the draft, with one property per column, a geometry property and a task that creates the features. Then the draft is published (**all** unpublished changes of the draft go live with it; problems are shown with a link to the builder) and the features are imported as runs. The bar shows "n of m imported"; invalid features are skipped and reported with their row number. "To the features" opens the data page of the new feature type.

The new feature type has no roles and no permissions: participants only see it once you give it roles and tasks in the builder. If the file has no geometry, a table is created instead of a feature type.

## Import over the API
For admins of the project only, and the project must already be published (otherwise `not_published`). Every call sends `multipart/form-data` with the file (`file`) and the mapping as JSON (`mapping`); the format comes from the file extension or the field `format`.
- **Dry run:** `POST /api/admin/p/<project>/import/plan` writes nothing and answers with the counts (`valid`, `problem_rows`), the problems (at most 200) and a preview of the first 10 rows as they would be written. Rules and permissions are checked only by the real import.
- **Import:** `POST /api/admin/p/<project>/import` with `mode` (`atomic` or `skip`) and `replace` (`true`/`false`) as well. The answer is a job id (`job`) at once. `GET /api/admin/p/<project>/import/<job>` shows the progress: `state` (`queued`, `running`, `done`, `failed`), `rows_done`, `rows_total`, `imported`, `outcome` (`accepted` or `refused`) and the problems. After a server restart an interrupted job reads `failed`. Largest file: 100 MB (otherwise 413 `file_too_large`).
- **Constant values** (v3: import into stage): `mapping.constants` maps a property to a value that applies to every row, the stage included, for example `{ "stage": "kontrolliert" }`. The value must fit the property (for the stage: one of its options) or the import is refused. It overrides what the task itself sets for that property.
- **Replace everything:** `replace: true` first sets every existing feature of the type to `deleted` and then imports the file, all as one unit. If anything is refused, the old data stays as it was. It needs `mode: atomic` (otherwise 422 `replace_needs_atomic`).

## Export
Export writes a **GeoPackage** (WGS84, height kept) with one table per feature type. Whoever exports gets exactly the rows and columns they see in the app; permissions and row filters apply as they do for sync. An export that is imported again gives the same values back.
