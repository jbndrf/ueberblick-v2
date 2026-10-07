/**
 * Pure builders of WP-200 ops for the roles & apps lens. No DOM: the lens, tests and assistants (H4)
 * share them (R1). Nothing here reads permission semantics; it only rewrites the audience values the
 * file holds, and `core.perms` says what they mean.
 */
import { AUDIENCES, type KeyPath, type PermAction, type RoleApp, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';

/** `$all`, the registry's audience keyword. */
const ALL = AUDIENCES.keys[0];

/** `role:kontrolle` is written as the bare key `kontrolle`; any other subject (`team:nord`, O12) as it is. */
export const entryOf = (subject: string): string =>
  subject.startsWith('role:') ? subject.slice(5) : subject;

type Audience = string | readonly string[] | undefined;

/** The audience after one subject is added to or removed from it. `$all` turns into the other roles on removal. */
export function nextAudience(
  current: Audience,
  subject: string,
  on: boolean,
  allSubjects: readonly string[],
): string | string[] {
  const entry = entryOf(subject);
  if (current === ALL) return on ? ALL : allSubjects.map(entryOf).filter((e) => e !== entry);
  const list = Array.isArray(current) ? (current as readonly string[]) : [];
  if (on) return list.includes(entry) ? [...list] : [...list, entry];
  return list.filter((e) => e !== entry);
}

/** The op that writes `permissions.<key>` of a type; a type without `permissions` gets the map added. */
function permissionsOp(file: TemplateFile, type: string, key: string, value: unknown): Op {
  if (file.types?.[type]?.permissions === undefined) {
    return { kind: 'add', path: `types.${type}.permissions`, value: { [key]: value } };
  }
  return { kind: 'set', path: `types.${type}.permissions.${key}`, value };
}

export interface CellEdit {
  readonly type: string;
  readonly action: PermAction;
  /** Set for a property cell of `see` or `write`. */
  readonly property?: string;
  readonly subject: string;
  readonly on: boolean;
}

/**
 * The op for one checkbox, or undefined when the file cannot take that edit from a cell: the whole-type
 * `see` / `write` cell while the file keys it by property, and a `see` property cell while it is not keyed
 * by property (restricting one property would first change who sees the row; `restrictSeeOp` does that).
 * Writing the whole `permissions.<action>` value keeps the overlay entry at one path (a nested `set`
 * under an earlier whole-value `set` is refused by `Doc.apply`).
 */
export function cellOp(file: TemplateFile, e: CellEdit): Op | undefined {
  const def = file.types?.[e.type];
  if (def === undefined) return undefined;
  const subjects = Object.keys(file.roles ?? {}).map((r) => `role:${r}`);
  const current = def.permissions?.[e.action] as Audience | Record<string, Audience>;
  const isMap = current !== undefined && typeof current === 'object' && !Array.isArray(current);
  if (e.property === undefined) {
    if (isMap) return undefined;
    return permissionsOp(
      file,
      e.type,
      e.action,
      nextAudience(current as Audience, e.subject, e.on, subjects),
    );
  }
  if (e.action !== 'see' && e.action !== 'write') return undefined;
  if (e.action === 'see' && !isMap) return undefined;
  const map: Record<string, Audience> = isMap
    ? { ...(current as Record<string, Audience>) }
    : Object.fromEntries(Object.keys(def.properties).map((k) => [k, current as Audience]));
  // In a `see` map an unlisted property stays visible to every role that sees the row; in a `write` map it is denied.
  const now = map[e.property] ?? (e.action === 'see' ? ALL : undefined);
  map[e.property] = nextAudience(now, e.subject, e.on, subjects);
  return permissionsOp(file, e.type, e.action, map);
}

/** Switches `see` to per-property entries: everyone still sees the row, single properties can then be restricted. */
export const restrictSeeOp = (file: TemplateFile, type: string): Op => permissionsOp(file, type, 'see', {});

/** An added entity is dropped (`reset`); one of the template is hidden (`hide`). */
const removeOp = (doc: Doc, path: KeyPath): Op =>
  doc.provenance(path) === 'added' ? { kind: 'reset', path } : { kind: 'hide', path };

/** `visible_when` text; empty removes the condition (undefined when there is none to remove). */
export function visibleWhenOp(doc: Doc, type: string, text: string): Op | undefined {
  const file = doc.effective();
  const has = file.types?.[type]?.permissions?.visible_when !== undefined;
  const value = text.trim();
  if (value === '') {
    return has ? removeOp(doc, `types.${type}.permissions.visible_when`) : undefined;
  }
  return permissionsOp(file, type, 'visible_when', value);
}

/** The keyed maps of a role's app profile that are edited one entry at a time (H3). */
export const APP_ENTRY_SECTIONS = [
  'views',
  'tools',
  'shortcuts',
] as const satisfies readonly (keyof RoleApp)[];
export type AppSection = (typeof APP_ENTRY_SECTIONS)[number];

/** Adds or removes one entry of `roles.<role>.app.<section>`; creates the missing parents on the way. */
export function appEntryOp(doc: Doc, role: string, section: AppSection, key: string, on: boolean): Op {
  const app = doc.effective().roles?.[role]?.app;
  const path = `roles.${role}.app.${section}.${key}`;
  if (!on) return removeOp(doc, path);
  if (doc.overlay().hide?.includes(path)) return { kind: 'unhide', path };
  if (app === undefined)
    return { kind: 'add', path: `roles.${role}.app`, value: { [section]: { [key]: {} } } };
  if (app[section] === undefined) {
    return { kind: 'add', path: `roles.${role}.app.${section}`, value: { [key]: {} } };
  }
  return { kind: 'add', path, value: {} };
}

/** The default view of a role's app. */
export function homeOp(doc: Doc, role: string, view: string): Op {
  if (doc.effective().roles?.[role]?.app === undefined) {
    return { kind: 'add', path: `roles.${role}.app`, value: { home: view } };
  }
  return { kind: 'set', path: `roles.${role}.app.home`, value: view };
}

/** Removes one preset of a role's app (values are edited in the YAML lens). */
export const removePresetOp = (doc: Doc, role: string, preset: string): Op =>
  removeOp(doc, `roles.${role}.app.presets.${preset}`);
