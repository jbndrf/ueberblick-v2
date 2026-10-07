/**
 * The data model as the lens draws it: feature types with properties, and the edges between them.
 * A pure view over the effective file and the provenance of the Doc (docs/08 "Data model").
 */
import { GEO_PREDICATES, relationCardinality, type Provenance } from '@ueberblick/core';
import type { Doc } from '../../doc';
import { labelOf } from '../../shell/location';
import type { MessageKey } from '../../shell/messages';

export interface PropertyModel {
  readonly key: string;
  readonly path: string;
  readonly label: string;
  readonly type: string;
  readonly provenance: Provenance;
  readonly required: boolean;
  readonly geometry: boolean;
  /** H1: a geometry property can carry a Z value (GeoJSON). */
  readonly z: boolean;
  /** The type's primary geometry (the one indexed); others are allowed. */
  readonly primary: boolean;
}

export interface EdgeModel {
  readonly path: string;
  readonly from: string;
  readonly to: string;
  readonly key: string;
  readonly label: string;
  /** Derived and inverse relations are dashed; picked references are solid. */
  readonly dashed: boolean;
  /** A reference property, not an entry of `relations`. */
  readonly property: boolean;
  readonly cardinality: string;
}

export interface TypeModel {
  readonly key: string;
  readonly path: string;
  readonly label: string;
  readonly provenance: Provenance;
  readonly properties: readonly PropertyModel[];
  readonly edges: readonly EdgeModel[];
}

export interface DataModel {
  readonly types: readonly TypeModel[];
  readonly edges: readonly EdgeModel[];
}

/** The spatial predicate a derive uses, as the edge label; else the expression itself. */
export function derivedLabel(derive: string): string {
  const m = /([A-Za-z]+)\s*\(/.exec(derive);
  return m?.[1] !== undefined && GEO_PREDICATES.has(m[1]) ? m[1] : derive;
}

export function buildModel(doc: Doc, locale: string): DataModel {
  const file = doc.effective();
  const types: TypeModel[] = [];
  for (const [tk, t] of Object.entries(file.types ?? {})) {
    const edges: EdgeModel[] = [];
    const properties = Object.entries(t.properties).map(([pk, p]): PropertyModel => {
      const path = `types.${tk}.properties.${pk}`;
      const geometry = p.type === 'geometry';
      if (p.type === 'reference' && p.to !== undefined) {
        edges.push({
          path,
          from: tk,
          to: p.to,
          key: pk,
          label: '',
          dashed: false,
          property: true,
          cardinality: 'one',
        });
      }
      return {
        key: pk,
        path,
        label: labelOf(p.label, locale, pk),
        type: p.type,
        provenance: doc.provenance(path),
        required: p.required === true,
        geometry,
        z: geometry,
        primary: t.geometry === pk,
      };
    });
    for (const [rk, r] of Object.entries(t.relations ?? {})) {
      edges.push({
        path: `types.${tk}.relations.${rk}`,
        from: tk,
        to: r.to,
        key: rk,
        label: r.derive !== undefined ? derivedLabel(r.derive) : (r.inverse_of ?? ''),
        dashed: r.derive !== undefined || r.inverse_of !== undefined,
        property: false,
        cardinality: relationCardinality(r),
      });
    }
    const path = `types.${tk}`;
    types.push({
      key: tk,
      path,
      label: labelOf(t.label, locale, tk),
      provenance: doc.provenance(path),
      properties,
      edges,
    });
  }
  return { types, edges: types.flatMap((t) => t.edges) };
}

/** The message that names a provenance mark (typed: a new provenance without a message fails to compile). */
export const provenanceKey = (p: Provenance): MessageKey => `dm_provenance_${p}`;

/**
 * R14: the first render must not be O(all properties). Boxes show their property rows while the rows
 * shown so far stay within this many; later boxes start collapsed behind one disclosure button.
 */
export const INITIAL_PROPERTIES = 40;

/** Keys of the boxes that start open: file order, the first always, then while the budget holds. */
export function initiallyOpen(types: readonly TypeModel[]): ReadonlySet<string> {
  const keys = new Set<string>();
  let shown = 0;
  for (const t of types) {
    if (keys.size > 0 && shown + t.properties.length > INITIAL_PROPERTIES) break;
    keys.add(t.key);
    shown += t.properties.length;
  }
  return keys;
}
