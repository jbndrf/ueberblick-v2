/** Property state: highest seq wins, reserved keys, geometry-derived values. */
import type { Derived, Geo, Geometry } from '../geo';
import type { FeatureAudit, FeatureId, Json, Key, RecordedObservation } from '../model';
import { LIFECYCLE_STATES, isServed, type LifecycleState } from '../registry/lifecycle';
import { RESERVED_CREATED_BY, auditOf, foldAudit } from './audit';
import type { FoldedFeature, FoldSchema } from './contract';

export const RESERVED_TYPE = '$type';
export const RESERVED_LIFECYCLE = '$lifecycle';
export const RESERVED_VERSION = '$version';

export interface StateResult {
  readonly feature: FoldedFeature | undefined;
  /** Non-reserved properties that received an observation newer than `prev`. */
  readonly changedProperties: readonly string[];
  readonly geometryChanged: readonly Key[];
}

export function isGeometry(v: Json | undefined): v is Json & Geometry {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return typeof (v as { readonly [k: string]: Json })['type'] === 'string';
}

const sameJson = (a: Json | undefined, b: Json | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));

export function foldFeature(
  geo: Geo,
  prev: FoldedFeature | undefined,
  observations: readonly RecordedObservation[],
  schema: FoldSchema,
): StateResult {
  const floor = prev?.updatedSeq ?? -Infinity;
  let fresh = observations.filter((o) => o.seq > floor);
  if (fresh.length === 0) return { feature: prev, changedProperties: [], geometryChanged: [] };
  for (let i = 1; i < fresh.length; i++) {
    if ((fresh[i - 1] as RecordedObservation).seq > (fresh[i] as RecordedObservation).seq) {
      fresh = [...fresh].sort((a, b) => a.seq - b.seq);
      break;
    }
  }
  let id: FeatureId | undefined = prev?.id;
  let type: Key | undefined = prev?.type;
  let lifecycle: LifecycleState = prev?.lifecycle ?? 'active';
  let audit: FeatureAudit = prev === undefined ? {} : auditOf(prev);
  let pinnedVersion: number | undefined = prev?.pinnedVersion;
  let updatedSeq = floor;
  const properties: { [key: string]: Json } = { ...prev?.properties };
  const changed = new Set<string>();
  for (const o of fresh) {
    id ??= o.featureId;
    updatedSeq = o.seq;
    audit = foldAudit(audit, o);
    if (o.property === RESERVED_TYPE) type = o.result as Key;
    else if (o.property === RESERVED_LIFECYCLE) {
      // Plan and the sync decoder refuse unknown states; a stray value is ignored, never stored as a property.
      if (LIFECYCLE_STATES.has(o.result as string)) lifecycle = o.result as LifecycleState;
    } else if (o.property === RESERVED_VERSION) {
      // A positive integer pins, null unpins; a stray value is ignored. Never a property.
      if (o.result === null) pinnedVersion = undefined;
      else if (Number.isInteger(o.result) && (o.result as number) > 0) pinnedVersion = o.result as number;
    } else if (o.property === RESERVED_CREATED_BY) {
      // Folded into `audit` above; never a property.
    } else {
      properties[o.property] = o.result;
      changed.add(o.property);
    }
  }
  if (id === undefined || type === undefined)
    return { feature: undefined, changedProperties: [], geometryChanged: [] };

  let derived: { [property: string]: Derived } = { ...prev?.derived };
  const geometryChanged: Key[] = [];
  const flipped = prev !== undefined && isServed(prev.lifecycle) !== isServed(lifecycle);
  for (const p of schema.types.get(type)?.geometryProperties ?? []) {
    if (flipped && !changed.has(p) && isGeometry(properties[p])) geometryChanged.push(p);
    if (!changed.has(p)) continue;
    const next = properties[p];
    if (sameJson(next, prev?.properties[p]) && prev?.type === type) continue;
    if (isGeometry(next)) derived = { ...derived, [p]: geo.derive(next) };
    else derived = Object.fromEntries(Object.entries(derived).filter(([key]) => key !== p));
    if (!geometryChanged.includes(p)) geometryChanged.push(p);
  }
  const feature: FoldedFeature = {
    id,
    type,
    properties,
    lifecycle,
    updatedSeq,
    derived,
    ...audit,
    ...(pinnedVersion === undefined ? {} : { pinnedVersion }),
  };
  return { feature, changedProperties: [...changed], geometryChanged };
}
