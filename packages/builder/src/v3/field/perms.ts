/**
 * Who sees and who edits ONE property: the per-property read and write of `permissions.see` and
 * `permissions.write` (v3 `FieldDefinitionEditor` "Sichtbar für Rollen" / "Bearbeitbar für Rollen").
 * Pure functions of the effective file, shared by the field pane and the permission matrix (WP-331),
 * which edits the same data in bulk. The meaning of an audience stays `core.perms`' (R1); this file only
 * reads and rewrites the audience values, so teams (O12) join later as more subjects.
 *
 * Semantics (core/perms/compile.ts): an absent audience denies; in a `see` map an unlisted property stays
 * visible to every role that sees the row; in a `write` map an unlisted property is denied. The UI keeps
 * v3's "Leer = alle": an empty role list writes `$all` (write) or removes the entry (see).
 */
import { AUDIENCES, type KeyPath, type TemplateFile } from '@ueberblick/core';
import type { Op } from '../../doc';

/** The actions that can be set per property. */
export const PROPERTY_ACTIONS = ['see', 'write'] as const;
export type PropertyAction = (typeof PROPERTY_ACTIONS)[number];

/** The registry's `$all`. */
const ALL = AUDIENCES.keys[0];

/**
 * What a property's audience is:
 * - `all`: every role (for `see`: every role that sees the row);
 * - `roles`: exactly these role keys (an empty list reads as `none`);
 * - `none`: nobody (the entry is absent in a `write` map, or an empty list);
 * - `row`: `see` only. The file's `see` is one audience for the whole row (a role list, or absent), so a
 *   property cannot be restricted without changing who sees the row. It is not editable from here.
 */
export type PropertyAudience =
  | { readonly kind: 'all' }
  | { readonly kind: 'roles'; readonly roles: readonly string[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'row' };

type Audience = string | readonly string[] | undefined;
type Value = Audience | Readonly<Record<string, Audience>>;

const isMap = (v: Value): v is Readonly<Record<string, Audience>> =>
  v !== undefined && typeof v === 'object' && !Array.isArray(v);

function ofAudience(a: Audience): PropertyAudience {
  if (a === ALL) return { kind: 'all' };
  if (Array.isArray(a)) return a.length === 0 ? { kind: 'none' } : { kind: 'roles', roles: [...a] };
  return { kind: 'none' };
}

const valueOf = (file: TemplateFile, type: string, action: PropertyAction): Value =>
  file.types?.[type]?.permissions?.[action] as Value;

export function propertyAudience(
  file: TemplateFile,
  type: string,
  action: PropertyAction,
  property: string,
): PropertyAudience {
  const v = valueOf(file, type, action);
  if (isMap(v)) {
    const entry = v[property];
    return entry === undefined && action === 'see' ? { kind: 'all' } : ofAudience(entry);
  }
  if (action === 'see') return v === ALL ? { kind: 'all' } : { kind: 'row' };
  return ofAudience(v);
}

/** The op that writes `permissions.<action>` as a whole (one overlay entry: a nested `set` under it would be refused). */
export function permissionsOp(file: TemplateFile, type: string, action: string, value: unknown): Op {
  if (file.types?.[type]?.permissions === undefined) {
    return { kind: 'add', path: `types.${type}.permissions`, value: { [action]: value } };
  }
  return { kind: 'set', path: `types.${type}.permissions.${action}` as KeyPath, value };
}

const without = <T>(map: Readonly<Record<string, T>>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));

const same = (a: PropertyAudience, b: PropertyAudience): boolean =>
  a.kind === b.kind &&
  (a.kind !== 'roles' ||
    (b.kind === 'roles' && a.roles.length === b.roles.length && a.roles.every((r) => b.roles.includes(r))));

/** What a property's audience can be set to from a picker or a matrix cell; `row` cannot be set from a property. */
export type SettableAudience = Exclude<PropertyAudience, { readonly kind: 'row' }>;

/**
 * The op that gives `property` exactly `next` as its audience, or undefined when it already has it or the
 * file cannot take the edit from a property (a `see` that is one audience for the whole row, `row` above).
 * `all` is "all roles" (v3: "Leer = alle"); `none` writes an empty list (nobody). A whole-type audience
 * becomes a map in which every other property keeps what it had.
 */
export function setPropertyAudienceOp(
  file: TemplateFile,
  type: string,
  action: PropertyAction,
  property: string,
  next: SettableAudience,
): Op | undefined {
  const def = file.types?.[type];
  if (def === undefined) return undefined;
  const now = propertyAudience(file, type, action, property);
  if (now.kind === 'row' || same(now, next)) return undefined;
  const current = valueOf(file, type, action);
  const base: Record<string, Audience> = isMap(current)
    ? { ...current }
    : current === undefined || (action === 'see' && current === ALL)
      ? {}
      : Object.fromEntries(Object.keys(def.properties).map((k) => [k, current as Audience]));
  if (next.kind === 'roles')
    return permissionsOp(file, type, action, { ...base, [property]: [...next.roles] });
  if (next.kind === 'none') return permissionsOp(file, type, action, { ...base, [property]: [] });
  // "All roles": a `see` map simply leaves the property out, a `write` map must say `$all`.
  return permissionsOp(
    file,
    type,
    action,
    action === 'see' ? without(base, property) : { ...base, [property]: ALL },
  );
}

/** `setPropertyAudienceOp` for a role list; an empty list is "all roles" (v3: "Leer = alle"). */
export const setPropertyRolesOp = (
  file: TemplateFile,
  type: string,
  action: PropertyAction,
  property: string,
  roles: readonly string[],
): Op | undefined =>
  setPropertyAudienceOp(
    file,
    type,
    action,
    property,
    roles.length === 0 ? { kind: 'all' } : { kind: 'roles', roles },
  );

/** The ops that take a property out of the `see` and `write` maps (it is being deleted); empty when it is in neither. */
export function dropPropertyPermsOps(file: TemplateFile, type: string, property: string): Op[] {
  const ops: Op[] = [];
  for (const action of PROPERTY_ACTIONS) {
    const v = valueOf(file, type, action);
    if (!isMap(v) || !(property in v)) continue;
    ops.push(permissionsOp(file, type, action, without(v, property)));
  }
  return ops;
}
