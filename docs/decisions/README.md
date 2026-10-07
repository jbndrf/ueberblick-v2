# Decision records

Short, binding decisions. **Accepted records are immutable.** To change one, write a new record with `Supersedes: NNNN` and get the owner's approval. Pending owner decisions are in [open.md](open.md). Use [template.md](template.md) for new records.

| # | Decision | Status |
|---|---|---|
| [0001](0001-full-rewrite-with-reference.md) | Full rewrite; v3 is read-only reference | accepted |
| [0002](0002-typescript-sveltekit-only-server.md) | TypeScript end to end; SvelteKit is the only server process | accepted |
| [0003](0003-sqlite-fixed-schema-db-per-project.md) | SQLite with a fixed platform schema, one DB file per project | accepted |
| [0004](0004-runs-only-write-path.md) | Runs are the only write path | accepted |
| [0005](0005-observations-no-builtin-properties.md) | Observations (O&M) are the truth; no built-in properties; one fold | accepted |
| [0006](0006-pure-core-with-ports.md) | One pure core package with ports | accepted |
| [0007](0007-cel-subset-four-backends.md) | The rule language is a CEL subset with four backends | accepted |
| [0008](0008-one-project-file.md) | One project file: Zod schema, versioned, compiled | accepted |
| [0009](0009-templates-base-plus-overlay.md) | Templates are base + overlay with key-wise three-way upgrades | accepted |
| [0010](0010-gis-vocabulary.md) | GIS/OGC vocabulary for data, process vocabulary for tasks | accepted |
| [0011](0011-relations-references-and-derived.md) | Relations = references + derived edges; bind follows declared relations | accepted |
| [0012](0012-permissions-compiled.md) | One permission section, compiled three ways | accepted |
| [0013](0013-geometry-crs-policy.md) | Geometry: WGS84 storage, source CRS on import, vetted predicates | accepted |
| [0014](0014-maplibre-style-spec.md) | Map styling uses the MapLibre Style Spec | accepted |
| [0015](0015-odk-field-vocabulary.md) | Form fields use the ODK vocabulary | accepted |
| [0016](0016-builder-is-an-ide.md) | The builder is an IDE for the project file | accepted |
| [0017](0017-tools-are-plugins.md) | Tools are plug-ins with a declared manifest | accepted |
| [0018](0018-carry-over-dbperf.md) | Carry over the dbperf designs: sync, device stores, map, PMTiles | accepted |
| [0019](0019-localized-strings.md) | LocalizedString for all project content from day one | accepted |
| [0020](0020-rules-offline-split.md) | Event rules are predicted offline; time rules run on the server | accepted |
