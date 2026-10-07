/**
 * Step 1 of the GeoJSON wizard (v3 `handleFileSelect`, `geojson-import-dialog.svelte:61-102`): the file is read in the
 * browser, checked for being a FeatureCollection, and surveyed (geometry kinds, one column per property with its
 * inferred type, core's `surveyFeatureCollection`). The name defaults to the file name without its extension.
 */
import {
  surveyFeatureCollection,
  type FeatureCollectionLike,
  type ImportColumnType,
  type Survey,
} from '@ueberblick/core';
import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';

/** A row of the review table: the property, the inferred type and the one the admin chose. */
export interface PropertyRow {
  name: string;
  inferred: ImportColumnType;
  selected: ImportColumnType;
}

export type GeojsonRead =
  | {
      readonly ok: true;
      readonly name: string;
      readonly survey: Survey;
      readonly collection: FeatureCollectionLike;
    }
  | { readonly ok: false; readonly error: AdminKey };

export async function readGeojson(file: File): Promise<GeojsonRead> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: 'import_geojson_parse_error' };
  }
  const surveyed = surveyFeatureCollection(parsed);
  if (!surveyed.ok)
    return {
      ok: false,
      error: surveyed.reason === 'no_features' ? 'import_geojson_empty' : 'import_geojson_invalid',
    };
  return {
    ok: true,
    name: file.name.replace(/\.(geojson|json)$/i, ''),
    survey: surveyed.survey,
    collection: surveyed.collection,
  };
}
