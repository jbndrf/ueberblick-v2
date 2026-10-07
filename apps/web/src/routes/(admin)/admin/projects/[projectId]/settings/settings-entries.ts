/**
 * The Infoseiten and Offline-Pakete edits on the project's document (WP-387). Both are keyed entries of the project file
 * (`info_pages.<key>`, `map.packs.<key>`), so create and edit are builder Doc ops (`set`, or `add` for the first entry of a
 * section) and delete is `reset`, plus `hide` when the template ships the entry: the draft overlay, never a hand-written
 * YAML edit (R1). Headless: a `Doc` in, the next one out.
 */
import type { Doc } from '@ueberblick/builder';
import type { InfoPage, TemplateFile } from '@ueberblick/core';
import { infoPageProblem, type InfoPageValues } from '../../../../../../lib/admin/settings/info-pages';
import { packProblem, type PackValues } from '../../../../../../lib/admin/settings/packs';
import { roleKeyOf } from '../roles/roles-doc';
import { named, run, type SettingsEdit } from './settings-doc';

type MapPack = NonNullable<NonNullable<TemplateFile['map']>['packs']>[string];

const pagesOf = (doc: Doc): Readonly<Record<string, InfoPage>> => doc.effective().info_pages ?? {};
const packsOf = (doc: Doc): Readonly<Record<string, MapPack>> | undefined => doc.effective().map?.packs;

/** `base`, or `base_2`, `base_3` ... when the key is taken. */
export function uniqueKey(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
}

const NOT_FOUND: SettingsEdit = { ok: false, code: 'not_found' };

/** Drops the entry at `path`: its overlay entry goes, and a template's own entry is hidden. */
function drop(doc: Doc, path: string, stillThere: (d: Doc) => boolean): SettingsEdit {
  const reset = doc.apply({ kind: 'reset', path });
  if (reset.refused) return { ok: false, code: 'refused', detail: reset.refused.message };
  if (!stillThere(reset.doc)) return { ok: true, doc: reset.doc };
  const hidden = reset.doc.apply({ kind: 'hide', path });
  if (hidden.refused) return { ok: false, code: 'refused', detail: hidden.refused.message };
  return { ok: true, doc: hidden.doc };
}

/**
 * Creates (no `key`: a key from the title) or changes an Infoseite. Title and content are written for the page language
 * when they are already per language, else as plain text (v3 had one language).
 */
export function setInfoPage(doc: Doc, v: InfoPageValues, locale: string): SettingsEdit {
  if (infoPageProblem(v) !== null) return { ok: false, code: 'invalid' };
  const pages = pagesOf(doc);
  const old = v.key === undefined ? undefined : pages[v.key];
  if (v.key !== undefined && old === undefined) return NOT_FOUND;
  const key = v.key ?? uniqueKey(roleKeyOf(v.title), Object.keys(pages));
  const value: InfoPage = {
    title: named(old?.title, locale, v.title.trim()),
    content: named(old?.content, locale, v.content),
    sort_order: v.sortOrder,
  };
  return run(doc, [{ kind: 'set', path: `info_pages.${key}`, value }]);
}

export function deleteInfoPage(doc: Doc, key: string): SettingsEdit {
  if (pagesOf(doc)[key] === undefined) return NOT_FOUND;
  return drop(doc, `info_pages.${key}`, (d) => pagesOf(d)[key] !== undefined);
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Writes one pack: the first pack of a file starts `map.packs`, later ones are `set` inside it. */
function putPack(doc: Doc, key: string, value: MapPack): SettingsEdit {
  return run(
    doc,
    packsOf(doc) === undefined
      ? [{ kind: 'add', path: 'map.packs', value: { [key]: value } }]
      : [{ kind: 'set', path: `map.packs.${key}`, value }],
  );
}

/** Creates (no `key`: a key from the name) or changes an Offline-Paket. Empty `roles` leaves the audience open (absent). */
export function setPack(doc: Doc, v: PackValues, locale: string): SettingsEdit {
  if (packProblem(v, doc.effective()) !== null) return { ok: false, code: 'invalid' };
  const packs = packsOf(doc) ?? {};
  const old = v.key === undefined ? undefined : packs[v.key];
  if (v.key !== undefined && old === undefined) return NOT_FOUND;
  const key = v.key ?? uniqueKey(roleKeyOf(v.name), Object.keys(packs));
  return putPack(doc, key, {
    label: named(old?.label, locale, v.name.trim()),
    bounds: [round(v.bounds[0]), round(v.bounds[1]), round(v.bounds[2]), round(v.bounds[3])],
    min_zoom: v.minZoom,
    max_zoom: v.maxZoom,
    layers: [...v.layers],
    ...(v.roles.length > 0 ? { roles: [...v.roles] } : {}),
  });
}

/** v3's inline roles column: only the audience of one pack changes. */
export function setPackRoles(doc: Doc, key: string, roles: readonly string[]): SettingsEdit {
  const old = packsOf(doc)?.[key];
  if (old === undefined) return NOT_FOUND;
  const open: MapPack = {
    label: old.label,
    bounds: old.bounds,
    min_zoom: old.min_zoom,
    max_zoom: old.max_zoom,
    layers: old.layers,
  };
  return putPack(doc, key, roles.length > 0 ? { ...open, roles: [...roles] } : open);
}

export function deletePack(doc: Doc, key: string): SettingsEdit {
  if (packsOf(doc)?.[key] === undefined) return NOT_FOUND;
  return drop(doc, `map.packs.${key}`, (d) => packsOf(d)?.[key] !== undefined);
}
