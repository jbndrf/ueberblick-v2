/**
 * The Projekteinstellungen edits on the project's document (WP-375, A-036). Branding and the map's default view are
 * config, so each save is a builder Doc op (`set`) on the draft overlay, never a hand-written YAML edit (R1). Headless:
 * it takes a `Doc` and returns the next one; the server module saves it and the page tells the shell.
 */
import { applyOps, type Doc, type Op } from '@ueberblick/builder';
import {
  defineRegistry,
  localize,
  type Branding,
  type KeyOf,
  type LocalizedString,
  type TemplateFile,
} from '@ueberblick/core';
import {
  MAP_VIEW_DEFAULTS,
  validateMapView,
  type MapViewError,
  type MapViewValues,
} from '../../../../../../lib/admin/settings/map-view';
import type { LayerFormError } from '../../../../../../lib/admin/settings/layers-model';
import type { BrandingView, MapView } from '../../../../../../lib/admin/settings/types';

export const SETTINGS_ERRORS = defineRegistry([
  { key: 'invalid', description: 'A Standardansicht value is out of range (the page shows which).' },
  { key: 'refused', description: 'The document model refused the edit (a lock, a schema problem).' },
  { key: 'no_version', description: 'Nothing is deployed yet, so there is no draft to edit.' },
  { key: 'conflict', description: 'The draft was saved by someone else in the meantime.' },
  { key: 'layer_invalid', description: 'A map layer form value is wrong (`layer` says which check failed).' },
  { key: 'no_layer', description: 'The map layer is not in the project file.' },
  { key: 'layer_in_pack', description: 'An offline pack still holds the map layer.' },
  {
    key: 'not_found',
    description: 'The info page or pack the call names is not in the draft (deleted meanwhile).',
  },
  { key: 'name_missing', description: 'A filter preset has no name (v3: settingsAdvancedNameMissing).' },
  { key: 'roles_missing', description: 'A filter preset is for no role; v4 keeps presets per role.' },
  { key: 'key_taken', description: 'Another filter preset already has this key in a role outside the edit.' },
] as const);
export type SettingsErrorCode = KeyOf<typeof SETTINGS_ERRORS>;
export type SettingsEdit =
  | { readonly ok: true; readonly doc: Doc }
  | {
      readonly ok: false;
      readonly code: SettingsErrorCode;
      readonly detail?: string;
      readonly fields?: readonly MapViewError[];
      readonly layer?: LayerFormError;
    };

export function brandingView(file: TemplateFile, locale: string): BrandingView {
  const b = file.branding;
  return { name: b?.name === undefined ? '' : localize(b.name, [locale]), icon: b?.icon ?? null };
}

export function mapView(file: TemplateFile): MapView {
  const map = file.map;
  const [lng, lat] = map?.start?.center ?? [];
  if (map?.start === undefined || lng === undefined || lat === undefined)
    return { ...MAP_VIEW_DEFAULTS, saved: false };
  return {
    lat,
    lng,
    zoom: map.start.zoom ?? MAP_VIEW_DEFAULTS.zoom,
    minZoom: map.min_zoom ?? MAP_VIEW_DEFAULTS.minZoom,
    maxZoom: map.max_zoom ?? MAP_VIEW_DEFAULTS.maxZoom,
    saved: true,
  };
}

export function run(doc: Doc, ops: readonly Op[]): SettingsEdit {
  const r = applyOps(doc, ops);
  if ('refused' in r) return { ok: false, code: 'refused', detail: r.refused.message };
  return { ok: true, doc: r.doc };
}

/** `text` for one language: a plain string is replaced, a language object gets its entry for `locale`. */
export function named(existing: LocalizedString | undefined, locale: string, text: string): LocalizedString {
  if (existing === undefined || typeof existing === 'string') return text;
  return { ...existing, [locale]: text };
}

const brandingOf = (doc: Doc): Branding => (doc.effective() as { branding?: Branding }).branding ?? {};

/**
 * Removes what is at `path`: drops the overlay's own entry, and hides it when the template itself still has one.
 * `present` says whether the effective file still holds it after the drop. The one removal the settings sections share.
 */
export function clearPath(
  doc: Doc,
  path: string,
  present: (effective: TemplateFile) => boolean,
): SettingsEdit {
  const dropped = doc.apply({ kind: 'reset', path });
  if (dropped.refused) return { ok: false, code: 'refused', detail: dropped.refused.message };
  if (!present(dropped.doc.effective())) return { ok: true, doc: dropped.doc };
  const hidden = dropped.doc.apply({ kind: 'hide', path });
  if (hidden.refused) return { ok: false, code: 'refused', detail: hidden.refused.message };
  return { ok: true, doc: hidden.doc };
}

const clear = (doc: Doc, key: keyof Branding): SettingsEdit =>
  clearPath(doc, `branding.${key}`, (file) => file.branding?.[key] !== undefined);

/**
 * Anzeigename and Projektsymbol, one overlay entry each (`branding.name`, `branding.icon`). `name: ''` clears the name
 * (the project name applies again), `icon: null` removes the icon; a key that is left out stays as it is.
 */
export function setBranding(
  doc: Doc,
  patch: { readonly name?: string; readonly icon?: string | null },
  locale: string,
): SettingsEdit {
  let cur: SettingsEdit = { ok: true, doc };
  const name = patch.name?.trim();
  if (name === '') cur = clear(doc, 'name');
  else if (name !== undefined)
    cur = run(doc, [
      { kind: 'set', path: 'branding.name', value: named(brandingOf(doc).name, locale, name) },
    ]);
  if (!cur.ok || patch.icon === undefined) return cur;
  if (patch.icon === null) return clear(cur.doc, 'icon');
  return run(cur.doc, [{ kind: 'set', path: 'branding.icon', value: patch.icon }]);
}

/** The Standardansicht: the map's start (centre, zoom) and its zoom bounds. */
export function setMapView(doc: Doc, v: MapViewValues): SettingsEdit {
  const fields = validateMapView(v);
  if (fields.length > 0) return { ok: false, code: 'invalid', fields };
  const start = { center: [v.lng, v.lat], zoom: v.zoom };
  // A file with no `map` gets one from the first op (the merge starts it with its layer list, docs/05). Every step must keep `min_zoom <= start.zoom <= max_zoom` (the document refuses an op that breaks the file), so
  // the bounds first widen to include the old zoom, then the start moves, then the bounds close in on the new values.
  const old = mapView(doc.effective()).zoom;
  return run(doc, [
    { kind: 'set', path: 'map.min_zoom', value: Math.min(v.minZoom, old) },
    { kind: 'set', path: 'map.max_zoom', value: Math.max(v.maxZoom, old) },
    { kind: 'set', path: 'map.start', value: start },
    { kind: 'set', path: 'map.min_zoom', value: v.minZoom },
    { kind: 'set', path: 'map.max_zoom', value: v.maxZoom },
  ]);
}
