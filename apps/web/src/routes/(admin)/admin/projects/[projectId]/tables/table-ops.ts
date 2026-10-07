/**
 * What the Tabellen pages write, as builder document ops (WP-382, S3-24). v3 kept a table in `custom_tables` and its
 * columns in `custom_table_columns`; here a table is a type without geometry and process and a column is one of its
 * properties, so every edit is an overlay op on the draft (Q16) and the publish bar picks it up. The property ops are
 * the builder's (`addPropertyOp`, `changeTypeOp`, `deletePropertyOps`, the field pane's): one set of ops for a property
 * whoever edits it (R1). Headless: each function takes a `Doc` and returns the next one; `tables.server.ts` saves it.
 * Rows are not here: they are runs (`$create`, `$correct`, `$lifecycle`).
 */
import {
  addPropertyOp,
  applyOps,
  changeTypeOp,
  deletePropertyOps,
  removeOp,
  setLabelOp,
  setRequiredOp,
  slugKey,
  type Doc,
  type Op,
} from '@ueberblick/builder';
import { AUDIENCES, localize, type KeyPath, type Problem, type Property } from '@ueberblick/core';
import { typeKeyFor } from '../../../shell/sidebar-types';
import type { ColumnSpec, TableErrorCode } from '../../../../../../lib/admin/tables/types';

export type TableEdit =
  | { readonly ok: true; readonly doc: Doc; readonly key?: string }
  | { readonly ok: false; readonly code: TableErrorCode; readonly detail?: string };

const KEY = /^[a-z][a-z0-9_]*$/;
const fail = (code: TableErrorCode, detail?: string): TableEdit => ({
  ok: false,
  code,
  ...(detail === undefined ? {} : { detail }),
});
const pathOf = (key: string): KeyPath => `types.${key}` as KeyPath;
const propPath = (type: string, key: string): KeyPath => `types.${type}.properties.${key}` as KeyPath;
const problemKey = (p: Problem): string => `${p.code}|${p.path}|${JSON.stringify(p.message)}`;

/** Applies `ops`; refuses on the Doc's own refusal, or when a problem appears that the document did not have. */
export function run(doc: Doc, ops: readonly Op[], locale: string, key?: string): TableEdit {
  if (ops.length === 0) return { ok: true, doc, ...(key === undefined ? {} : { key }) };
  const before = new Set(doc.problems().map(problemKey));
  const r = applyOps(doc, ops);
  if ('refused' in r) return fail('refused', r.refused.message);
  const fresh = r.problems.find((p) => !before.has(problemKey(p)));
  if (fresh !== undefined) return fail('problem', localize(fresh.message, [locale]) || fresh.code);
  return { ok: true, doc: r.doc, ...(key === undefined ? {} : { key }) };
}

const audienceValue = (roles: readonly string[] | undefined): unknown =>
  roles === undefined || roles.length === 0 ? AUDIENCES.keys[0] : [...roles];

/** `permissions.see` as a whole (one overlay entry: a nested `set` under it would be refused). */
function seeOp(doc: Doc, table: string, roles: readonly string[]): Op {
  const value = audienceValue(roles);
  return doc.effective().types?.[table]?.permissions === undefined
    ? { kind: 'add', path: `types.${table}.permissions` as KeyPath, value: { see: value } }
    : { kind: 'set', path: `types.${table}.permissions.see` as KeyPath, value };
}

const textOp = (doc: Doc, table: string, field: 'description', locale: string, text: string): Op => {
  const current = doc.effective().types?.[table]?.[field];
  const next = typeof current === 'object' ? { ...current, [locale]: text } : { [locale]: text };
  return { kind: 'set', path: `types.${table}.${field}` as KeyPath, value: next };
};

export interface NewTable {
  readonly name: string;
  readonly key?: string;
  readonly description?: string;
  readonly mainColumn: string;
  readonly roles?: readonly string[];
}

/** v3 `createTable`: the table with its first column ("Hauptspalte"); no roles means every role. */
export function createTable(doc: Doc, input: NewTable, locale: string): TableEdit {
  const name = input.name.trim();
  const main = input.mainColumn.trim();
  if (name === '' || main === '') return fail('name_empty');
  const taken = Object.keys(doc.effective().types ?? {});
  const typed = input.key?.trim();
  if (typed !== undefined && typed !== '' && !KEY.test(typed)) return fail('bad_key');
  const key = typed === undefined || typed === '' ? typeKeyFor(name, taken) : typed;
  if (taken.includes(key)) return fail('key_exists');
  const column = slugKey(main, new Set());
  const description = input.description?.trim();
  const entry = {
    label: { [locale]: name },
    ...(description ? { description: { [locale]: description } } : {}),
    permissions: { see: audienceValue(input.roles) },
    properties: { [column]: { type: 'text', label: { [locale]: main }, required: true } },
  };
  return run(doc, [{ kind: 'add', path: pathOf(key), value: entry }], locale, key);
}

export interface TablePatch {
  readonly name?: string;
  readonly description?: string;
  readonly mainColumn?: string;
  readonly roles?: readonly string[];
}

/** v3 `updateField` / `updateTableMeta`: the name, description, Hauptspalte (the first column's label) and roles. */
export function updateTable(doc: Doc, table: string, patch: TablePatch, locale: string): TableEdit {
  const def = doc.effective().types?.[table];
  if (def === undefined) return fail('unknown_table');
  const ops: Op[] = [];
  if (patch.name !== undefined) {
    if (patch.name.trim() === '') return fail('name_empty');
    ops.push(setLabelOp(doc.effective(), pathOf(table), locale, patch.name.trim()));
  }
  if (patch.description !== undefined)
    ops.push(textOp(doc, table, 'description', locale, patch.description.trim()));
  if (patch.mainColumn !== undefined) {
    const first = Object.keys(def.properties)[0];
    if (patch.mainColumn.trim() === '') return fail('column_empty');
    if (first !== undefined)
      ops.push(setLabelOp(doc.effective(), propPath(table, first), locale, patch.mainColumn.trim()));
  }
  if (patch.roles !== undefined) ops.push(seeOp(doc, table, patch.roles));
  return run(doc, ops, locale);
}

/** v3 `delete`: the table leaves the draft; its rows leave with the next publish (the deploy overview names them). */
export function deleteTable(doc: Doc, table: string): TableEdit {
  if (doc.effective().types?.[table] === undefined) return fail('unknown_table');
  return run(doc, [removeOp(doc, pathOf(table))], 'de');
}

const sameDefault = (a: unknown, b: unknown): boolean => a === b || (a === undefined && b === undefined);

/**
 * v3's column manager (create, update, delete of a `custom_table_columns` row) and the order the table shows: the whole
 * list the admin ended with, as the ops that turn the draft's columns into it. The key of a column never changes; a
 * removed column is hidden or dropped like the field pane does it, with its entries in forms and permission maps.
 */
export function saveColumns(doc: Doc, table: string, next: readonly ColumnSpec[], locale: string): TableEdit {
  const def = doc.effective().types?.[table];
  if (def === undefined) return fail('unknown_table');
  // A column the draft does not have yet comes with a temporary key; its property key is made from its name here, with
  // the builder's `slugKey`, so there is one way to make a key (R1) and it is unique among the properties.
  const taken = new Set(Object.keys(def.properties));
  const resolved = next.map((c) => {
    if (c.key in def.properties) return c;
    const key = slugKey(c.label, taken);
    taken.add(key);
    return { ...c, key };
  });
  const names = new Set<string>();
  for (const c of resolved) {
    const label = c.label.trim().toLowerCase();
    if (label === '') return fail('column_empty');
    if (names.has(label)) return fail('column_exists', c.label);
    names.add(label);
  }
  const typeKeys = Object.keys(doc.effective().types ?? {});
  let cur = doc;
  const apply = (ops: readonly Op[]): TableEdit | null => {
    const r = run(cur, ops, locale);
    if (!r.ok) return r;
    cur = r.doc;
    return null;
  };
  const wanted = new Set(resolved.map((c) => c.key));
  for (const key of Object.keys(def.properties))
    if (!wanted.has(key)) {
      const failed = apply(deletePropertyOps(cur, table, key));
      if (failed) return failed;
    }
  for (const c of resolved) {
    const existing = cur.effective().types?.[table]?.properties[c.key];
    const ops: Op[] = [];
    if (existing === undefined) {
      ops.push(
        addPropertyOp(table, c.key, {
          label: c.label.trim(),
          locale,
          type: c.type as Property['type'],
          ...(c.required === true ? { required: true } : {}),
        }),
      );
      if (c.default !== undefined)
        ops.push({ kind: 'set', path: `${propPath(table, c.key)}.default` as KeyPath, value: c.default });
    } else {
      const file = cur.effective();
      const defaultPath = `${propPath(table, c.key)}.default` as KeyPath;
      // A new type first: its op writes the whole property, which supersedes the label and required entries below it, so
      // those follow it. A default of the old type goes (the op itself drops the template's, a reset the overlay's).
      if (existing.type !== c.type) {
        const retype = changeTypeOp(file, table, c.key, c.type as Property['type'], typeKeys);
        if (retype !== undefined) ops.push({ kind: 'reset', path: defaultPath }, retype);
        if (c.default !== undefined) ops.push({ kind: 'set', path: defaultPath, value: c.default });
      } else if (!sameDefault(existing.default, c.default))
        ops.push(
          c.default === undefined
            ? { kind: 'reset', path: defaultPath }
            : { kind: 'set', path: defaultPath, value: c.default },
        );
      if (localize(existing.label, [locale]) !== c.label.trim())
        ops.push(setLabelOp(file, propPath(table, c.key), locale, c.label.trim()));
      if ((existing.required === true) !== (c.required === true))
        ops.push(setRequiredOp(file, propPath(table, c.key), c.required === true));
    }
    const failed = apply(ops);
    if (failed) return failed;
  }
  const order = resolved.map((c) => c.key);
  const have = Object.keys(cur.effective().types?.[table]?.properties ?? {});
  if (order.join() !== have.join()) {
    const failed = apply([{ kind: 'order', path: `types.${table}.properties` as KeyPath, keys: order }]);
    if (failed) return failed;
  }
  return { ok: true, doc: cur };
}
