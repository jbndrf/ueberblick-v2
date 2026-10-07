# A-036 Branding (name, icon) and map zoom bounds are project-file config
priority: low        status: provisional
date: 2026-10-02   lead: a   work packages: WP-375   touches: H3, H5, H6, R13

## Context
v3's Projekteinstellungen has Branding (Anzeigename `display_name`, Projektsymbol `icon`) and Standardansicht (centre, zoom, min and max zoom). v4 has `map.start` (centre, zoom) but nowhere for the name, the icon or the zoom bounds, and the participant bootstrap (WP-611) had a placeholder for the icon. Both are setup, so they go through the draft (Q13/Q16).

## Options
- A) **Config in the project file:** a top-level `branding: { name?, icon? }` and `map.min_zoom` / `map.max_zoom`. The icon is a blob; the file stores its sha. Published with the rest, versioned, previewable.
- B) **Project settings outside the file** (a table next to the project row, as v3's `projects.settings`). Changes would not be versioned, previewed or part of a template.

## Chosen (provisional)
A. It is the one write path (runs and the draft), it versions with the file and a template can ship a default name. `branding` is a plain object, so a role app (H3) can carry the same shape later; the command centre (H5) reads the same object. The icon upload is a new admin-only endpoint with a type list and a size cap from the registry (`BRANDING_ICON_TYPES`, `BRANDING_ICON_MAX_BYTES`); the existing blob route stays for run files. Blob read access: the sha a deployed config names as `branding.icon` is readable by every participant (`blobs/access.ts`, `configBlobs`), because no feature or run refers to it.
- `min_zoom <= start.zoom <= max_zoom` is a schema refinement of `MapSchema` (problem `schema_invalid`, the existing registry code), not a new code.
- **Seam:** `projectInfoOf` is the one place that turns branding into the bootstrap's name and icon; `configBlobs` is the one list of blobs a config makes public (a later "logo per role app" adds its sha there).
- **Provisional detail:** the bootstrap has no language, so a per-language name resolves German first, then any language. The merge accepts `branding` as a section an overlay may start (one word in `merge.ts`).
- **SVG icons (review round 1):** `image/svg+xml` stays allowed because v3 allowed it, and it is stored unsanitised. That is safe because (a) the blob route answers every blob with `content-security-policy: default-src 'none'; sandbox` and `x-content-type-options: nosniff` (tested for an SVG with a script, `blobs.spec.ts`), and (b) the icon is only ever rendered through `<img src>` (admin Branding preview, participant header), never inlined or via `{@html}`, so scripts in an SVG do not run.
- **Open:** orphaned icon blobs stay in the store after a replace or remove (no garbage collection of unreferenced blobs exists yet).

## Cost to change later
low (two optional fields and one section; no data depends on them).
