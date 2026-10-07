/**
 * Registries of the import layer (R6). They live next to their only user until the lead moves them into
 * `packages/core/src/registry` (outside this package's ownership).
 */
import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** Import formats (F8: import formats are a registry). Shapefile is a later entry. */
export const IMPORT_FORMATS = defineRegistry([
  { key: 'csv', description: 'Comma or semicolon separated text; the geometry comes from x/y(/z) columns.' },
  { key: 'geojson', description: 'A GeoJSON FeatureCollection, Feature or geometry (RFC 7946).' },
  { key: 'geopackage', description: 'An OGC GeoPackage; one feature table (layer) is read.' },
] as const);
export type ImportFormat = KeyOf<typeof IMPORT_FORMATS>;

/** What a bad row does: `atomic` refuses the whole file, `skip` imports the good rows and reports the bad ones. */
export const IMPORT_MODES = defineRegistry([
  { key: 'atomic', description: 'One bad row refuses the whole import; nothing is written.' },
  { key: 'skip', description: 'Bad rows are reported and left out; the others are imported.' },
] as const);
export type ImportMode = KeyOf<typeof IMPORT_MODES>;

/**
 * Problems found in a row before it becomes a run. Refusals from plan keep their own registry codes
 * (`REFUSAL_CODES`); an import problem carries either kind.
 */
export const IMPORT_PROBLEM_CODES = defineRegistry([
  { key: 'file_unreadable', description: 'The file is not valid for its format.' },
  {
    key: 'row_malformed',
    description: 'The row has the wrong number of columns or a value of the wrong type.',
  },
  { key: 'geometry_invalid', description: 'The geometry is missing, malformed, empty or of the wrong kind.' },
  { key: 'crs_unsupported', description: 'The source CRS is not one the platform can reproject.' },
  { key: 'mapping_invalid', description: 'The mapping names a task, field or column that does not exist.' },
] as const);
export type ImportProblemCode = KeyOf<typeof IMPORT_PROBLEM_CODES>;
