/**
 * The Filter & Felder presets on the project's document (WP-386, S3-17). v3 kept one project-wide list
 * (`admin_presets`); v4 keeps a preset per role (`roles.<r>.app.filter_presets.<key>`, WP-640 and owner decision 3),
 * so the list shows one row per preset and the roles that hold it, and a save writes it to each chosen role. Every
 * edit is a builder Doc op on the draft overlay (R1, R3). Headless: a `Doc` in, the next `Doc` out.
 */
import { applyOps, type Doc, type Op } from '@ueberblick/builder';
import { localize, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import type { PresetRef, PresetRow, PresetSave } from '../../../../../../lib/admin/settings/presets-types';
import { roleKeyOf } from '../roles/roles-doc';
import { clearPath, type SettingsEdit } from './settings-doc';

type Presets = NonNullable<NonNullable<NonNullable<TemplateFile['roles']>[string]['app']>['filter_presets']>;
type Preset = Presets[string];

const presetsOf = (file: TemplateFile, role: string): Presets =>
  file.roles?.[role]?.app?.filter_presets ?? {};

const sameSource = (a: Preset, b: Preset): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The presets of every role, one row for each distinct preset: roles that hold the same key with the same name and
 * filter share a row, in file order. `conditions` counts the rows the filter builder shows for the filter.
 */
export function presetRows(
  file: TemplateFile,
  locale: string,
  conditions: (filters: Readonly<Record<string, string>>) => number,
): readonly PresetRow[] {
  const groups: { key: string; preset: Preset; roles: string[] }[] = [];
  for (const role of Object.keys(file.roles ?? {}))
    for (const [key, preset] of Object.entries(presetsOf(file, role))) {
      const group = groups.find((g) => g.key === key && sameSource(g.preset, preset));
      if (group) group.roles.push(role);
      else groups.push({ key, preset, roles: [role] });
    }
  return groups.map(({ key, preset, roles }) => ({
    key,
    label: localize(preset.label, [locale]) || key,
    roles,
    filters: preset.filters,
    conditions: conditions(preset.filters),
  }));
}

/** A key from a typed name, unique among all roles' presets. */
function freshKey(file: TemplateFile, name: string): string {
  const taken = new Set(Object.keys(file.roles ?? {}).flatMap((r) => Object.keys(presetsOf(file, r))));
  const base = /[a-z0-9]/i.test(name.normalize('NFD')) ? roleKeyOf(name) : 'preset';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

/** `text` for one language: a plain label is replaced, a language object gets its entry for `locale`. */
function named(existing: LocalizedString | undefined, locale: string, text: string): LocalizedString {
  if (existing === undefined || typeof existing === 'string') return text;
  return { ...existing, [locale]: text };
}

const fail = (code: Extract<SettingsEdit, { ok: false }>['code'], detail?: string): SettingsEdit =>
  detail === undefined ? { ok: false, code } : { ok: false, code, detail };

/**
 * Saves a preset for `input.roles`. A new one (no `key`) gets a key from its name. An edit rewrites the preset in every
 * role that keeps it and removes it from the roles in `was` that are no longer chosen. Writing to a role that holds the
 * same key as a different preset is refused (`key_taken`), so one preset never replaces another.
 */
export function savePreset(doc: Doc, input: PresetSave, locale: string): SettingsEdit {
  const name = input.name.trim();
  if (name === '') return fail('name_missing');
  if (input.roles.length === 0) return fail('roles_missing');
  const file = doc.effective();
  const unknown = [...input.roles, ...(input.was ?? [])].find((r) => file.roles?.[r] === undefined);
  if (unknown !== undefined) return fail('refused', `unknown role ${unknown}`);
  const key = input.key ?? freshKey(file, name);
  const was = new Set(input.was ?? []);
  const old = [...was].map((r) => presetsOf(file, r)[key]).find((p) => p !== undefined);
  const value: Preset = { label: named(old?.label, locale, name), filters: input.filters };
  if (input.roles.some((r) => !was.has(r) && presetsOf(file, r)[key] !== undefined)) return fail('key_taken');

  let cur = doc;
  for (const role of was) {
    if (input.roles.includes(role)) continue;
    const r = removeFrom(cur, role, key);
    if (!r.ok) return r;
    cur = r.doc;
  }
  const ops: Op[] = input.roles.flatMap((role): Op[] => {
    const app = cur.effective().roles?.[role]?.app;
    const path = `roles.${role}.app.filter_presets`;
    if (app === undefined)
      return [{ kind: 'set', path: `roles.${role}.app`, value: { filter_presets: { [key]: value } } }];
    if (app.filter_presets === undefined) return [{ kind: 'set', path, value: { [key]: value } }];
    // a preset hidden by an earlier delete must be shown again before it can be set
    return [
      { kind: 'unhide', path: `${path}.${key}` },
      { kind: 'set', path: `${path}.${key}`, value },
    ];
  });
  const r = applyOps(cur, ops);
  if ('refused' in r) return fail('refused', r.refused.message);
  return { ok: true, doc: r.doc };
}

function removeFrom(doc: Doc, role: string, key: string): SettingsEdit {
  return clearPath(
    doc,
    `roles.${role}.app.filter_presets.${key}`,
    (file) => presetsOf(file, role)[key] !== undefined,
  );
}

/** Removes the preset from every role that holds it. */
export function deletePreset(doc: Doc, ref: PresetRef): SettingsEdit {
  let cur: SettingsEdit = { ok: true, doc };
  for (const role of ref.roles) {
    if (!cur.ok) return cur;
    cur = removeFrom(cur.doc, role, ref.key);
  }
  return cur;
}
