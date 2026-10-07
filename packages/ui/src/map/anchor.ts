import type { FoldedFeature } from '@ueberblick/core/fold';
import type { Key } from '@ueberblick/core/model';
import type { MapFeature } from './contract';
import { isServed } from '@ueberblick/core/registry';

/**
 * Reduces a folded feature to a map feature for one geometry property. The anchor is the fold's
 * `derived.pointOnSurface` (decision 0013), never a vertex mean. Returns undefined when the
 * property has no geometry value (the feature has nothing to draw).
 */
export function toMapFeature(feature: FoldedFeature, geometryProperty: Key): MapFeature | undefined {
  const derived = feature.derived[geometryProperty];
  const geometry = feature.properties[geometryProperty];
  if (derived === undefined || geometry === undefined || geometry === null || !isServed(feature.lifecycle)) {
    return undefined;
  }
  return {
    id: feature.id,
    anchor: derived.pointOnSurface.coordinates,
    // The fold validated the value as a geometry of this property type.
    geometry: geometry as unknown as MapFeature['geometry'],
    properties: feature.properties,
  };
}
