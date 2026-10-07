// Apart from the schemas (property.ts) so that the compiler's environment never pulls zod in (WP-975).
import type { RelationCardinality } from '../registry';
import type { Relation } from './property';

/** The effective cardinality of a relation, applying the defaults of A-004 item 3. */
export function relationCardinality(r: Relation): RelationCardinality {
  return r.cardinality ?? (r.derive !== undefined || r.inverse_of !== undefined ? 'many' : 'one');
}

/** One way a child type takes its position: through its reference property `property`, from a `parentType` feature. */
export interface InheritedPosition {
  readonly property: string;
  readonly parentType: string;
}

/**
 * The child types that have no position of their own (B-019), from the `inherit_position` relations of the types: per
 * child type its reference property and the parent type. Pure; the map layer reads it to draw a child at its parent.
 */
export function inheritRelations(
  types: Readonly<Record<string, { readonly relations?: Readonly<Record<string, Relation>> | undefined }>>,
): ReadonlyMap<string, readonly InheritedPosition[]> {
  const out = new Map<string, InheritedPosition[]>();
  for (const [parentType, type] of Object.entries(types)) {
    for (const r of Object.values(type.relations ?? {})) {
      if (r.inherit_position !== true || r.inverse_of === undefined) continue;
      const [childType, property] = r.inverse_of.split('.') as [string, string];
      const list = out.get(childType) ?? [];
      list.push({ property, parentType });
      out.set(childType, list);
    }
  }
  return out;
}
