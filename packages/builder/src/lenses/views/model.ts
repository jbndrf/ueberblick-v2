/**
 * The views view (docs/08 "Map & views"): a pure function of the Doc. Views are data (H4); a layer's
 * style is opaque here (its renderer owns the format), so the model only says whether a layer has
 * none, a reference to a style file (`$ref`, not editable in the lens) or an inline style.
 */
import type { Json, Provenance } from '@ueberblick/core';
import type { Doc } from '../../doc';
import { labelOf } from '../../shell/location';

export type LayerSourceItem =
  | { readonly kind: 'view' }
  | { readonly kind: 'type'; readonly type: string; readonly filter?: string }
  | { readonly kind: 'asset'; readonly asset: string; readonly format?: string };

export type LayerStyleItem =
  | { readonly kind: 'none' }
  | { readonly kind: 'ref'; readonly ref: string }
  | { readonly kind: 'inline'; readonly value: { readonly [key: string]: Json } };

export interface LayerItem {
  readonly key: string;
  readonly renderer: string;
  readonly source: LayerSourceItem;
  readonly style: LayerStyleItem;
  readonly provenance: Provenance;
}

export interface ViewItem {
  readonly key: string;
  readonly label: string;
  readonly source: { readonly type: string; readonly filter?: string };
  readonly sort: readonly string[];
  readonly layers: readonly LayerItem[];
  readonly provenance: Provenance;
}

const isRecord = (v: unknown): v is { readonly [key: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

type RawSource = { type?: string; filter?: string; asset?: string; format?: string };

function sourceOf(raw: RawSource | undefined): LayerSourceItem {
  if (raw === undefined) return { kind: 'view' };
  if (raw.asset !== undefined) {
    return { kind: 'asset', asset: raw.asset, ...(raw.format !== undefined ? { format: raw.format } : {}) };
  }
  return { kind: 'type', type: raw.type ?? '', ...(raw.filter !== undefined ? { filter: raw.filter } : {}) };
}

function styleOf(raw: unknown): LayerStyleItem {
  if (!isRecord(raw)) return { kind: 'none' };
  if (typeof raw.$ref === 'string') return { kind: 'ref', ref: raw.$ref };
  return { kind: 'inline', value: raw };
}

export function buildViews(doc: Doc, locale: string): readonly ViewItem[] {
  const views = doc.effective().views ?? {};
  return Object.entries(views).map(([key, v]) => ({
    key,
    label: labelOf(v.label, locale, key),
    source: { type: v.source.type, ...(v.source.filter !== undefined ? { filter: v.source.filter } : {}) },
    sort: v.sort ?? [],
    provenance: doc.provenance(`views.${key}`),
    layers: Object.entries(v.layers ?? {}).map(([layerKey, l]) => ({
      key: layerKey,
      renderer: l.renderer,
      source: sourceOf(l.source as RawSource | undefined),
      style: styleOf(l.style),
      provenance: doc.provenance(`views.${key}.layers.${layerKey}`),
    })),
  }));
}
