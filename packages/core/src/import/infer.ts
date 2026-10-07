/**
 * Type inference for a file that becomes a new Objektart (v3 `inferFieldType`, `registry/field-type-inference.ts`, and
 * `inferGeometryType`, `feature-store/import.ts:48-58`). Pure: the wizard reads the file in the browser and shows the
 * result; the same function serves any other reader of features (H6). Conservative like v3: anything ambiguous is text,
 * because an import mirrors the source and never converts lossily.
 */
import { GEO_GEOMETRY_TYPES, type GeoGeometryType } from '../registry/geo';
import type { GeometryTypeKey } from '../registry/schema-enums';
import type { ImportColumnType } from './column-types';

/** Strings longer than this infer long text (v3 `LONG_TEXT_THRESHOLD`). */
export const LONG_TEXT_THRESHOLD = 120;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
/** A decimal number as a person writes it; a leading zero (a postcode, an id) is text, not a number. */
const DECIMAL = /^[+-]?(0|[1-9]\d*)([.,]\d+)?$/;

const isPresent = (v: unknown): boolean =>
  v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

/** The column type for the values of one property across all features. */
export function inferColumnType(values: readonly unknown[]): ImportColumnType {
  const present = values.filter(isPresent);
  if (present.length === 0) return 'text';
  if (present.every((v) => typeof v === 'boolean')) return 'boolean';
  if (present.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'number';
  if (present.every((v) => typeof v === 'string')) {
    const strings = (present as string[]).map((s) => s.trim());
    if (strings.every((s) => ISO_DATE.test(s))) return 'date';
    if (strings.every((s) => ISO_DATE.test(s) || ISO_DATETIME.test(s))) return 'datetime';
    if (strings.every((s) => DECIMAL.test(s))) return 'number';
    return (present as string[]).some((s) => s.length > LONG_TEXT_THRESHOLD) ? 'long_text' : 'text';
  }
  return present.some((v) => typeof v === 'object') ? 'long_text' : 'text';
}

export interface SurveyColumn {
  readonly name: string;
  readonly inferred: ImportColumnType;
}

export interface Survey {
  readonly featureCount: number;
  /** The GeoJSON kinds found, in order of first appearance. */
  readonly geometryKinds: readonly GeoGeometryType[];
  /** One per property key found in any feature, in order of first appearance. */
  readonly columns: readonly SurveyColumn[];
}

/** What the wizard needs of a parsed FeatureCollection. */
export interface FeatureCollectionLike {
  readonly type: 'FeatureCollection';
  readonly features: readonly {
    readonly type?: string;
    readonly geometry?: unknown;
    readonly properties?: Readonly<Record<string, unknown>> | null;
  }[];
}

export type SurveyResult =
  | { readonly ok: true; readonly survey: Survey; readonly collection: FeatureCollectionLike }
  | { readonly ok: false; readonly reason: 'not_feature_collection' | 'no_features' };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** v3's check (`geojson-import-dialog.svelte:75-79`), plus: a collection without features has nothing to import. */
export function surveyFeatureCollection(parsed: unknown): SurveyResult {
  if (!isObject(parsed) || parsed['type'] !== 'FeatureCollection' || !Array.isArray(parsed['features']))
    return { ok: false, reason: 'not_feature_collection' };
  const collection = parsed as unknown as FeatureCollectionLike;
  if (collection.features.length === 0) return { ok: false, reason: 'no_features' };

  const kinds: GeoGeometryType[] = [];
  const valuesByKey = new Map<string, unknown[]>();
  for (const feature of collection.features) {
    const kind = isObject(feature?.geometry) ? feature.geometry['type'] : undefined;
    if (typeof kind === 'string' && GEO_GEOMETRY_TYPES.has(kind) && !kinds.includes(kind)) kinds.push(kind);
    const props = feature?.properties;
    if (!isObject(props)) continue;
    for (const [key, value] of Object.entries(props)) {
      const list = valuesByKey.get(key);
      if (list) list.push(value);
      else valuesByKey.set(key, [value]);
    }
  }
  return {
    ok: true,
    collection,
    survey: {
      featureCount: collection.features.length,
      geometryKinds: kinds,
      columns: [...valuesByKey].map(([name, values]) => ({ name, inferred: inferColumnType(values) })),
    },
  };
}

const KEY_OF_KIND: Readonly<Record<GeoGeometryType, GeometryTypeKey>> = {
  Point: 'point',
  MultiPoint: 'multipoint',
  LineString: 'linestring',
  MultiLineString: 'multilinestring',
  Polygon: 'polygon',
  MultiPolygon: 'multipolygon',
  GeometryCollection: 'any',
};

/** The `geometry_type` of the new property: the one kind found, `any` for several, null for none (a Tabelle). */
export function geometryKeyOf(kinds: readonly GeoGeometryType[]): GeometryTypeKey | null {
  const [first, ...rest] = kinds;
  if (first === undefined) return null;
  return rest.length === 0 ? KEY_OF_KIND[first] : 'any';
}
