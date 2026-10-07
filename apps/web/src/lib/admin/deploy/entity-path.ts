/**
 * The element a diff entry is about, in plain words (WP-360): `types.baum.label.de` changed is "Objektart Baum
 * geändert", `types.baum.properties.stage.options.massnahme` removed is "Option Maßnahme entfernt". Pure; the server
 * collapses entries per element with it and the browser picks the noun from the same path.
 */
import { formatKeyPath, parseKeyPath } from '@ueberblick/core';
import { ORDERED_MAPS, type OrderedMap } from '@ueberblick/core/registry/compile';

/** The segments of the element at the end of `segments`: a type, a property or relation, an option, a top-level entity. */
export function entitySegments(segments: readonly string[]): readonly string[] {
  const [section, , kind, , sub] = segments;
  if (section === 'tasks' && kind === 'auto' && segments.length >= 4) return segments.slice(0, 4);
  if (section === 'types' && (kind === 'properties' || kind === 'relations')) {
    return kind === 'properties' && sub === 'options' && segments.length >= 6
      ? segments.slice(0, 6)
      : segments.slice(0, 4);
  }
  return segments.slice(0, 2);
}

/** The path of that element (`types.baum.properties.stage`), for entries a deeper key changed. */
export function entityPathOf(path: string): string {
  const segments = parseKeyPath(path) ?? [path];
  const entity = entitySegments(segments);
  return entity.length === segments.length ? path : formatKeyPath(entity);
}

/** An ordered map's path read as a line: which map it is, and the element that owns it (`null`: the project's own). */
export interface OrderTarget {
  readonly map: OrderedMap;
  readonly owner: string | null;
}

/**
 * The `ORDERED_MAPS` pattern `segments` is an instance of (`*` is one key), and the owner of that map: the Objektart
 * of `types.baum.properties`, the task of `tasks.melden.form`, the property of `...options`, the role of
 * `roles.r.app.views`. A pattern without `*` (`types`, `map.layers`) belongs to no element.
 */
export function orderTargetOf(segments: readonly string[]): OrderTarget | undefined {
  const map = ORDERED_MAPS.keys.find((pattern) => {
    const parts = pattern.split('.');
    return parts.length === segments.length && parts.every((p, i) => p === '*' || p === segments[i]);
  });
  if (map === undefined) return undefined;
  return { map, owner: map.includes('*') ? formatKeyPath(entitySegments(segments.slice(0, -1))) : null };
}

/** The kind of element a path ends in, as the key of its noun ("Objektart", "Eigenschaft", "Option", "Aufgabe", ...). */
export function nounOf(path: string, stage: boolean): string {
  const [section, , kind, , sub] = parseKeyPath(path) ?? [path];
  if (section === 'tasks' && kind === 'auto' && sub !== undefined) return 'auto';
  if (section === 'types') {
    if (kind === undefined) return 'type';
    if (kind === 'relations') return 'relation';
    return sub === 'options' ? (stage ? 'stage' : 'option') : 'property';
  }
  return section ?? 'other';
}
