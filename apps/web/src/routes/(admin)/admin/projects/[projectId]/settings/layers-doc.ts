/**
 * The Kartenebenen edits on the project's document (WP-385, v3 `LayersSection.svelte`): add, change, remove and order the
 * layers of `map.layers` / `map.order` as builder Doc ops on the draft overlay, never a second layer schema (R1). A layer
 * the template brought is hidden or overridden, one the overlay added is added or reset, so removing one never touches
 * the template. Headless: it takes a `Doc` and returns the next one; the server module saves it.
 */
import type { Doc, Op } from '@ueberblick/builder';
import { formatKeyPath, orderedLayerKeys, type MapConfig } from '@ueberblick/core';
import {
  layerKeyFor,
  validateLayerDraft,
  validateSource,
  type LayerDraft,
  type LayerOp,
  type LayerPatch,
} from '../../../../../../lib/admin/settings/layers-model';
import { named, type SettingsEdit } from './settings-doc';

const mapOf = (doc: Doc): MapConfig | undefined => doc.effective().map;
const at = (...rest: string[]): string => formatKeyPath(['map', ...rest]);

const refused = (message: string): SettingsEdit => ({ ok: false, code: 'refused', detail: message });

/** The value at `segs` in the effective file, or undefined. */
function valueAt(doc: Doc, segs: readonly string[]): unknown {
  let node: unknown = doc.effective();
  for (const s of segs) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[s];
  }
  return node;
}

/** Applies the ops one after the other; the first refusal stops it (the caller then keeps the Doc it started with). */
function run(doc: Doc, ops: readonly Op[]): SettingsEdit {
  let cur = doc;
  for (const op of ops) {
    const r = cur.apply(op);
    if (r.refused) return refused(r.refused.message);
    cur = r.doc;
  }
  return { ok: true, doc: cur };
}

/** Takes the value at `segs` away: the overlay's own entry is dropped, and a template value is hidden. */
function clear(doc: Doc, segs: readonly string[]): SettingsEdit {
  const path = formatKeyPath(segs);
  const dropped = doc.apply({ kind: 'reset', path });
  if (dropped.refused) return refused(dropped.refused.message);
  if (valueAt(dropped.doc, segs) === undefined) return { ok: true, doc: dropped.doc };
  const hidden = dropped.doc.apply({ kind: 'hide', path });
  return hidden.refused ? refused(hidden.refused.message) : { ok: true, doc: hidden.doc };
}

/** Runs the steps in order, each on the Doc the one before made. */
function chain(doc: Doc, steps: ReadonlyArray<(d: Doc) => SettingsEdit>): SettingsEdit {
  let cur: SettingsEdit = { ok: true, doc };
  for (const step of steps) {
    if (!cur.ok) return cur;
    cur = step(cur.doc);
  }
  return cur;
}

/** One layer is the default base at a time: the others lose `on_at_start`. */
function clearOtherDefaults(doc: Doc, keep: string): SettingsEdit {
  const layers = mapOf(doc)?.layers ?? {};
  const others = Object.entries(layers).filter(
    ([k, l]) => k !== keep && l.kind === 'base' && l.on_at_start === true,
  );
  return chain(
    doc,
    others.map(
      ([k]) =>
        (d: Doc) =>
          clear(d, ['map', 'layers', k, 'on_at_start']),
    ),
  );
}

const orderWithout = (doc: Doc, key: string): string[] | null => {
  const order = mapOf(doc)?.order;
  return order?.includes(key) ? order.filter((k) => k !== key) : null;
};

function layerValue(layer: LayerDraft, label: string): Record<string, unknown> {
  return {
    label,
    kind: layer.kind,
    source: layer.source,
    ...(layer.attribution?.trim() ? { attribution: layer.attribution.trim() } : {}),
    ...(layer.opacity !== undefined && layer.opacity !== 1 ? { opacity: layer.opacity } : {}),
    ...(layer.minzoom === undefined ? {} : { minzoom: layer.minzoom }),
    ...(layer.maxzoom === undefined ? {} : { maxzoom: layer.maxzoom }),
    ...(layer.roles && layer.roles.length > 0 ? { roles: [...layer.roles] } : {}),
    ...(layer.on_at_start === true ? { on_at_start: true } : {}),
  };
}

function add(doc: Doc, layer: LayerDraft): SettingsEdit {
  const bad = validateLayerDraft(layer);
  if (bad !== null) return { ok: false, code: 'layer_invalid', layer: bad };
  const taken = [...Object.keys(mapOf(doc)?.layers ?? {}), ...Object.keys(doc.template.map?.layers ?? {})];
  const key = layerKeyFor(layer.label, taken);
  const created = run(doc, [
    { kind: 'add', path: at('layers', key), value: layerValue(layer, layer.label.trim()) },
  ]);
  if (!created.ok || layer.on_at_start !== true || layer.kind !== 'base') return created;
  return clearOtherDefaults(created.doc, key);
}

const NUMBER_FIELDS = ['opacity', 'minzoom', 'maxzoom'] as const;

function update(doc: Doc, key: string, patch: LayerPatch, locale: string): SettingsEdit {
  const current = mapOf(doc)?.layers[key];
  if (current === undefined) return { ok: false, code: 'no_layer' };
  if (patch.label !== undefined && patch.label.trim() === '')
    return { ok: false, code: 'layer_invalid', layer: 'name_required' };
  if (patch.source !== undefined) {
    const bad = validateSource(patch.source);
    if (bad !== null) return { ok: false, code: 'layer_invalid', layer: bad };
  }
  const layer = (...rest: string[]): string[] => ['map', 'layers', key, ...rest];
  const set = (field: string, value: unknown) => (d: Doc) =>
    run(d, [{ kind: 'set', path: formatKeyPath(layer(field)), value }]);
  const drop = (field: string) => (d: Doc) => clear(d, layer(field));
  const steps: Array<(d: Doc) => SettingsEdit> = [];
  if (patch.label !== undefined) steps.push(set('label', named(current.label, locale, patch.label.trim())));
  if (patch.kind !== undefined) steps.push(set('kind', patch.kind));
  if (patch.source !== undefined) steps.push(set('source', patch.source));
  if (patch.attribution !== undefined)
    steps.push(
      patch.attribution === null || patch.attribution.trim() === ''
        ? drop('attribution')
        : set('attribution', patch.attribution.trim()),
    );
  for (const f of NUMBER_FIELDS) {
    const v = patch[f];
    if (v === undefined) continue;
    steps.push(v === null || (f === 'opacity' && v === 1) ? drop(f) : set(f, v));
  }
  if (patch.roles !== undefined)
    steps.push(
      patch.roles === null || patch.roles.length === 0 ? drop('roles') : set('roles', [...patch.roles]),
    );
  const kindChanged = patch.kind !== undefined && patch.kind !== current.kind;
  // A layer that changes kind starts without the old kind's "on at start", unless this save says otherwise.
  if (patch.on_at_start === true) steps.push(set('on_at_start', true));
  else if (
    patch.on_at_start === false ||
    patch.on_at_start === null ||
    (kindChanged && patch.on_at_start === undefined)
  )
    steps.push(drop('on_at_start'));
  const done = chain(doc, steps);
  const kind = patch.kind ?? current.kind;
  return done.ok && patch.on_at_start === true && kind === 'base' ? clearOtherDefaults(done.doc, key) : done;
}

function remove(doc: Doc, key: string): SettingsEdit {
  const map = mapOf(doc);
  if (map?.layers[key] === undefined) return { ok: false, code: 'no_layer' };
  if (Object.values(map.packs ?? {}).some((p) => p.layers.includes(key)))
    return { ok: false, code: 'layer_in_pack' };
  const order = orderWithout(doc, key);
  return chain(doc, [
    (d) =>
      order === null ? { ok: true, doc: d } : run(d, [{ kind: 'set', path: at('order'), value: order }]),
    (d) => clear(d, ['map', 'layers', key]),
  ]);
}

function reorder(doc: Doc, keys: readonly string[]): SettingsEdit {
  const map = mapOf(doc);
  const have = map === undefined ? [] : orderedLayerKeys(map);
  if (
    keys.length !== have.length ||
    new Set(keys).size !== keys.length ||
    !keys.every((k) => have.includes(k))
  )
    return refused('The order must name every layer once.');
  if (keys.every((k, i) => k === have[i])) return { ok: true, doc };
  return run(doc, [{ kind: 'set', path: at('order'), value: [...keys] }]);
}

/** One save of the Kartenebenen section on the draft's Doc. */
export function applyLayerOp(doc: Doc, call: LayerOp, locale: string): SettingsEdit {
  switch (call.op) {
    case 'add':
      return add(doc, call.layer);
    case 'update':
      return update(doc, call.key, call.patch, locale);
    case 'remove':
      return remove(doc, call.key);
    case 'order':
      return reorder(doc, call.keys);
  }
}
