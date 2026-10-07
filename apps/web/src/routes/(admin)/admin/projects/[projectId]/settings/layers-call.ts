/** The body of a `layers` call as a `LayerOp`, or null when its shape is wrong (the checks of the values are `layers-model.ts`). */
import { MAP_LAYER_KINDS, MAP_SOURCE_TYPES } from '@ueberblick/core';
import type {
  LayerDraft,
  LayerOp,
  LayerPatch,
  LayerSource,
} from '../../../../../../lib/admin/settings/layers-model';

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const kindOk = (v: unknown): boolean => isStr(v) && MAP_LAYER_KINDS.keys.includes(v as never);

function readSource(v: unknown): LayerSource | null {
  if (!isBag(v) || !isStr(v['type']) || !MAP_SOURCE_TYPES.keys.includes(v['type'] as never)) return null;
  return v as LayerSource;
}

const FIELDS = [
  ['attribution', isStr],
  ['opacity', isNum],
  ['minzoom', isNum],
  ['maxzoom', isNum],
  ['roles', strings],
  ['on_at_start', isBool],
] as const;

/** The optional fields of `b` that are present: `null` stays `null` (take it away); a wrong shape is `false`. */
function readFields(b: Bag): Bag | false {
  const out: Bag = {};
  for (const [key, ok] of FIELDS) {
    if (!(key in b)) continue;
    const v = b[key];
    if (v !== null && !ok(v)) return false;
    out[key] = v;
  }
  return out;
}

function readDraft(v: unknown): LayerDraft | null {
  if (!isBag(v) || !isStr(v['label']) || !kindOk(v['kind'])) return null;
  const source = readSource(v['source']);
  const fields = readFields(v);
  if (source === null || fields === false) return null;
  // A draft has no "take away": a null is the same as the field left out.
  const present = Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== null));
  return { label: v['label'], kind: v['kind'] as LayerDraft['kind'], source, ...present };
}

function readPatch(v: unknown): LayerPatch | null {
  if (!isBag(v)) return null;
  const fields = readFields(v);
  if (fields === false) return null;
  const out: Bag = { ...fields };
  if ('label' in v) {
    if (!isStr(v['label'])) return null;
    out['label'] = v['label'];
  }
  if ('kind' in v) {
    if (!kindOk(v['kind'])) return null;
    out['kind'] = v['kind'];
  }
  if ('source' in v) {
    const source = readSource(v['source']);
    if (source === null) return null;
    out['source'] = source;
  }
  return out as LayerPatch;
}

export function readLayerOp(b: Bag): LayerOp | null {
  switch (b['op']) {
    case 'add': {
      const layer = readDraft(b['layer']);
      return layer === null ? null : { op: 'add', layer };
    }
    case 'update': {
      const patch = readPatch(b['patch']);
      return isStr(b['key']) && patch !== null ? { op: 'update', key: b['key'], patch } : null;
    }
    case 'remove':
      return isStr(b['key']) ? { op: 'remove', key: b['key'] } : null;
    case 'order':
      return strings(b['keys']) ? { op: 'order', keys: b['keys'] } : null;
    default:
      return null;
  }
}
