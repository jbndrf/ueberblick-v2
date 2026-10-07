/**
 * v3's entity selector (`EntitySelectorConfig` and `EntitySelectorModal`, register a3-builder row 167) as what the
 * engine has: "Auswählen aus" Tabelle is a `reference` property to a table (a feature type without geometry and
 * process), Teilnehmende a `participant` property; "Kann jeden auswählen" and "Nur Selbstauswahl" are the form
 * entry's `constraint`; "Rollen mit Sichtbarkeit" is the property's `see` roles (WP-337's `setPropertyRolesOp`, R1).
 * "Mehrfachauswahl erlauben" is the property's `cardinality: many` (a list of ids), "Anzeigefeld" a reference's
 * `display_property` (A-048). Rollen is a `role` property (A-051, a role key of the project; Mehrfachauswahl as above). Pure, no DOM.
 *
 * The constraint (written and read by one grammar; anything else is `foreign` and stays untouched):
 *
 *   value == actor.id || 'a' in actor.roles || !('s' in actor.roles || ...)
 *
 * Everybody may pick themselves. `a` are the roles that may pick anyone. The last part is there when there are
 * roles `s` that may only pick themselves: then every other role may pick anyone; without it only the `a` roles may.
 */
import { isTable, localizeExact, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { clearOps, setFieldAttrOps, setOps, withLocalized } from '../../lenses/task/edit';
import type { Translate } from '../../shell/messages';
import { changeTypeOp } from '../field/ops';
import { propertyAudience, setPropertyRolesOp, type PropertyAudience } from '../field/perms';
import { labelOf } from '../../shell/location';
import { formOf } from './model';

export interface RoleLists {
  /** "Kann jeden auswählen": these roles may pick any participant. */
  readonly any: readonly string[];
  /** "Nur Selbstauswahl": these roles may only pick themselves. */
  readonly self: readonly string[];
}

export type ParsedEntityConstraint =
  { readonly foreign: false; readonly roles: RoleLists } | { readonly foreign: true; readonly expr: string };

const ROLE = String.raw`'[A-Za-z_][A-Za-z0-9_]*' in actor\.roles`;
const LIST = String.raw`${ROLE}(?: \|\| ${ROLE})*`;
const SHAPE = new RegExp(String.raw`^value == actor\.id(?: \|\| (${LIST}))?(?: \|\| !\((${LIST})\))?$`);
const rolesIn = (list: string | undefined): string[] =>
  list === undefined ? [] : [...list.matchAll(/'([^']+)' in actor\.roles/g)].map((m) => m[1] as string);

const terms = (roles: readonly string[]): string => roles.map((r) => `'${r}' in actor.roles`).join(' || ');

/** The constraint the role lists say; `undefined` when both are empty. */
export function entityConstraintOf(roles: RoleLists): string | undefined {
  if (roles.any.length === 0 && roles.self.length === 0) return undefined;
  const parts = ['value == actor.id'];
  if (roles.any.length > 0) parts.push(terms(roles.any));
  if (roles.self.length > 0) parts.push(`!(${terms(roles.self)})`);
  return parts.join(' || ');
}

export function parseEntityConstraint(source: string | undefined): ParsedEntityConstraint {
  if (source === undefined) return { foreign: false, roles: { any: [], self: [] } };
  const m = SHAPE.exec(source);
  if (m === null) return { foreign: true, expr: source };
  return { foreign: false, roles: { any: rolesIn(m[1]), self: rolesIn(m[2]) } };
}

/** The property type each source writes. */
const TYPE_OF_SOURCE = { table: 'reference', participants: 'participant', roles: 'role' } as const;
export type EntitySource = keyof typeof TYPE_OF_SOURCE;
const SOURCE_OF_TYPE: Readonly<Partial<Record<string, EntitySource>>> = {
  reference: 'table',
  participant: 'participants',
  role: 'roles',
};

/** A property of the table the picker can show ("Anzeigefeld"): a text or a number, the kinds a name is made of. */
export interface DisplayChoice {
  readonly key: string;
  readonly label: string;
  /** The property type key, shown under the label (v3 listed the column type). */
  readonly kind: string;
}

const NAMEABLE: readonly string[] = ['text', 'localized_text', 'number', 'integer', 'select'];

export interface EntityConfig {
  readonly source: EntitySource | undefined;
  /** `to` of a reference. */
  readonly table: string | undefined;
  readonly constraint: ParsedEntityConstraint;
  /** A Rollen source: who may pick which role, the property's `select` (A-055); empty lists: every role may pick any. */
  readonly roleSelect: RoleLists;
  readonly see: PropertyAudience;
  /** "Mehrfachauswahl erlauben". */
  readonly many: boolean;
  /** "Anzeigefeld" of a table source: the property of the table shown; absent: the display name (B-014). */
  readonly display: string | undefined;
  /** The properties of the table "Anzeigefeld" offers. */
  readonly columns: readonly DisplayChoice[];
  /** Why "Mehrfachauswahl" cannot be turned off, when it cannot (many to one breaks the stored values). */
  readonly manyLocked: boolean;
}

export function entityConfigOf(
  file: TemplateFile,
  task: string,
  type: string,
  key: string,
  locale = 'de',
  template?: TemplateFile,
): EntityConfig {
  const prop = file.types?.[type]?.properties[key];
  const target = prop?.type === 'reference' && prop.to !== undefined ? file.types?.[prop.to] : undefined;
  return {
    many: prop?.cardinality === 'many',
    display: prop?.type === 'reference' ? prop.display_property : undefined,
    columns: Object.entries(target?.properties ?? {})
      .filter(([, p]) => NAMEABLE.includes(p.type))
      .map(([k, p]) => ({ key: k, label: labelOf(p.label, locale, k), kind: p.type })),
    manyLocked: prop?.cardinality === 'many' && manyLocked(template, type, key),
    source: prop === undefined ? undefined : SOURCE_OF_TYPE[prop.type],
    table: prop?.type === 'reference' ? prop.to : undefined,
    constraint: parseEntityConstraint(formOf(file, task)[key]?.constraint),
    roleSelect: {
      any: prop?.type === 'role' ? (prop.select?.all ?? []) : [],
      self: prop?.type === 'role' ? (prop.select?.self ?? []) : [],
    },
    see: propertyAudience(file, type, 'see', key),
  };
}

/**
 * "Mehrfachauswahl" cannot go from many back to one while the template the project is built on declares the property
 * many: that version's data hold lists of ids, which a single-id property refuses. A property made many in the
 * project's own overlay can be switched back. (Deploy does not yet classify many to one as breaking: WP-443 follow-up.)
 */
export const manyLocked = (template: TemplateFile | undefined, type: string, key: string): boolean =>
  template?.types?.[type]?.properties[key]?.cardinality === 'many';

export interface TableChoice {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

/** The tables of the project: the feature types without geometry and process (what the admin's Tabellen lists). */
export function tablesOf(file: TemplateFile, locale: string): TableChoice[] {
  return Object.entries(file.types ?? {})
    .filter(([, def]) => isTable(def))
    .map(([key, def]) => ({
      key,
      label: labelOf(def.label, locale, key),
      description:
        def.description === undefined ? '' : localizeExact(def.description as LocalizedString, locale),
    }));
}

/** The source switched; moving to a table or to roles drops the role rule, which is only about participants (v3 cleared it too). */
export function sourceOps(
  doc: Doc,
  task: string,
  type: string,
  key: string,
  source: EntitySource,
  tableKeys: readonly string[],
  locale: string,
  t: Translate,
): readonly Op[] {
  const op = changeTypeOp(doc.effective(), type, key, TYPE_OF_SOURCE[source], tableKeys);
  if (op === undefined) return [];
  // Both sources hold one id or a list of them: Mehrfachauswahl survives the switch, Anzeigefeld (a table's) does not.
  const own = `types.${type}.properties.${key}.cardinality`;
  const many = doc.effective().types?.[type]?.properties[key]?.cardinality === 'many';
  // The replaced property carries Mehrfachauswahl itself; an overlay entry of the key would override it.
  const resets: Op[] = many && doc.provenance(own) !== 'template' ? [{ kind: 'reset', path: own }] : [];
  const moved: Op =
    many && op.kind === 'set' ? { ...op, value: { ...(op.value as object), cardinality: 'many' } } : op;
  // The Anzeigefeld goes first: a participant property refuses it.
  const shown = doc.effective().types?.[type]?.properties[key]?.display_property !== undefined;
  const dropped = shown ? clearOps(doc, `types.${type}.properties.${key}.display_property`) : [];
  const before = [...dropped, ...resets];
  let cleared = doc;
  for (const o of before) cleared = cleared.apply(o).doc;
  const switched = cleared.apply(moved).doc;
  if (source === 'participants') return [...before, moved];
  return [...before, moved, ...rolesOps(switched, task, type, key, { any: [], self: [] }, locale, t)];
}

/** The table a reference points at. An Anzeigefeld the new table does not have goes (it would not compile). */
export function tableOps(doc: Doc, type: string, key: string, to: string): readonly Op[] {
  const file = doc.effective();
  const prop = file.types?.[type]?.properties[key];
  if (prop?.to === to) return [];
  const at = `types.${type}.properties.${key}`;
  const lacks =
    prop?.display_property !== undefined && file.types?.[to]?.properties[prop.display_property] === undefined;
  return [
    ...(lacks ? clearOps(doc, `${at}.display_property`) : []),
    { kind: 'set', path: `${at}.to`, value: to } as Op,
  ];
}

/** The role lists as the form entry's `constraint` and its message; none for a constraint the lists did not write. */
export function rolesOps(
  doc: Doc,
  task: string,
  type: string,
  key: string,
  roles: RoleLists,
  locale: string,
  t: Translate,
): readonly Op[] {
  const entry = formOf(doc.effective(), task)[key] ?? {};
  if (parseEntityConstraint(entry.constraint).foreign) return [];
  const source = entityConstraintOf(roles);
  if (source === entry.constraint) return [];
  const first = setFieldAttrOps(doc, task, key, 'constraint', source);
  let cur = doc;
  for (const op of first) cur = cur.apply(op).doc;
  const message = source === undefined ? '' : t('form_entity_msg_self');
  return [
    ...first,
    ...setFieldAttrOps(
      cur,
      task,
      key,
      'constraint_message',
      withLocalized(entry.constraint_message, locale, message),
    ),
  ];
}

/**
 * A Rollen source's "Kann jeden auswählen" / "Nur Selbstauswahl" (v3 EntitySelectorModal.svelte:372-405): the role
 * property's `select` (A-055). Both lists empty takes `select` out: every role may pick any.
 */
export function roleSelectOps(doc: Doc, type: string, key: string, lists: RoleLists): readonly Op[] {
  const prop = doc.effective().types?.[type]?.properties[key];
  if (prop?.type !== 'role') return [];
  const path = `types.${type}.properties.${key}.select`;
  if (lists.any.length === 0 && lists.self.length === 0)
    return prop.select === undefined ? [] : clearOps(doc, path);
  return setOps(doc, path, {
    ...(lists.any.length > 0 ? { all: [...lists.any] } : {}),
    ...(lists.self.length > 0 ? { self: [...lists.self] } : {}),
  });
}

/** "Rollen mit Sichtbarkeit": the roles that see the property; empty is every role. */
export const seeOps = (doc: Doc, type: string, key: string, roles: readonly string[]): readonly Op[] => {
  const op = setPropertyRolesOp(doc.effective(), type, 'see', key, roles);
  return op === undefined ? [] : [op];
};

/** "Mehrfachauswahl erlauben": `cardinality: many`; off takes the key out (one is the default). Refused many to one when locked. */
export function manyOps(doc: Doc, type: string, key: string, many: boolean, locked: boolean): readonly Op[] {
  const prop = doc.effective().types?.[type]?.properties[key];
  if (prop === undefined || (prop.cardinality === 'many') === many) return [];
  const path = `types.${type}.properties.${key}.cardinality`;
  if (many) return setOps(doc, path, 'many');
  return locked ? [] : clearOps(doc, path);
}

/** "Anzeigefeld": the property of the table the picker shows; `undefined` goes back to the display name (B-014). */
export function displayOps(doc: Doc, type: string, key: string, display: string | undefined): readonly Op[] {
  const prop = doc.effective().types?.[type]?.properties[key];
  if (prop === undefined || prop.display_property === display) return [];
  const path = `types.${type}.properties.${key}.display_property`;
  return display === undefined ? clearOps(doc, path) : setOps(doc, path, display);
}
