/**
 * The form editor's edits as WP-200 ops (v3 wrote through `taskStore.addFieldRef/updateFieldRef/reorderFieldRefs`
 * and the builder state; the file is the store here). Pure, no DOM: the cards, the palettes and an
 * assistant (H4) share them (R1). Every edit is a change of the layout (`layout.ts`); `layoutOps` turns the
 * difference to the file into ops: remove, add, `order`, `page`, and the `column` and `row` of the form entries.
 */
import { formatKeyPath, localizeExact, type Json, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { slugKey } from '../../lenses/data-model/ops';
import { addFieldOps, removeFieldOps, setFieldAttrOps, withPage } from '../../lenses/task/edit';
import { setPropertyAudienceOp } from '../field/perms';
import {
  keysOf,
  place,
  remove,
  rowsOf,
  setColumn,
  setPageMeta,
  startPageAt,
  joinPageAt,
  deletePage,
  step,
  type Column,
  type Dest,
  type Layout,
  type PageMeta,
} from './layout';
import { tablesOf } from './entity';
import { editorModel, formOf } from './model';
import type { PaletteTile } from './palette';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The ops that make the form of `task` read as `next`. `fallback` is the builder's type, for a task without `creates`. */
export function layoutOps(doc: Doc, task: string, fallback: string, next: Layout): readonly Op[] {
  const ops: Op[] = [];
  let cur = doc;
  const run = (made: readonly Op[]): void => {
    for (const op of made) {
      ops.push(op);
      cur = cur.apply(op).doc;
    }
  };
  const file = (): TemplateFile => cur.effective();
  const want = keysOf(next);
  const wanted = new Set(want);
  const formPath = formatKeyPath(['tasks', task, 'form']);

  // An earlier `order` that names a key about to leave is cut first: the file refuses to hide a key an order lists.
  const ordered = cur.overlay().order?.[formPath];
  if (ordered?.some((k) => !wanted.has(k)) === true)
    run([{ kind: 'order', path: formPath, keys: ordered.filter((k) => wanted.has(k)) }]);
  for (const key of Object.keys(formOf(file(), task)))
    if (!wanted.has(key)) run(removeFieldOps(cur, task, key));
  for (const key of want) if (!(key in formOf(file(), task))) run(addFieldOps(cur, task, key));
  if (want.length > 0 && !same(Object.keys(formOf(file(), task)), want)) {
    run([{ kind: 'order', path: formPath, keys: want }]);
  }

  // A page starts at the first field of its page; the first page only carries a marker when it has a title or description.
  for (const [i, page] of next.pages.entries()) {
    const first = page.lines[0]?.[0]?.key;
    for (const cell of page.lines.flat()) {
      const marker: Json | undefined =
        cell.key === first ? (i === 0 ? page.meta : (page.meta ?? {})) : undefined;
      if (!same(formOf(file(), task)[cell.key]?.page, marker))
        run(setFieldAttrOps(cur, task, cell.key, 'page', marker));
    }
  }

  // Width and line live on the form entry (A-049); the property's `display` is the Daten view's and stays.
  const form = formOf(file(), task);
  const rows = rowsOf(next, (k) => form[k]?.row);
  for (const cell of next.pages.flatMap((p) => p.lines.flat())) {
    const entry = form[cell.key];
    if (entry === undefined) continue;
    const row = rows.get(cell.key);
    const column = cell.column === 'full' ? undefined : cell.column;
    if (entry.column !== column) run(setFieldAttrOps(cur, task, cell.key, 'column', column));
    if (entry.row !== row) run(setFieldAttrOps(cur, task, cell.key, 'row', row));
  }
  return ops;
}

const layoutNow = (doc: Doc, task: string, fallback: string): Layout =>
  editorModel(doc.effective(), task, fallback, 'de').layout;

/** One edit of the layout as ops. */
export function editOps(
  doc: Doc,
  task: string,
  fallback: string,
  edit: (layout: Layout) => Layout,
): readonly Op[] {
  return layoutOps(doc, task, fallback, edit(layoutNow(doc, task, fallback)));
}

export const placeOps = (doc: Doc, task: string, fallback: string, key: string, dest: Dest): readonly Op[] =>
  editOps(doc, task, fallback, (l) => place(l, key, dest));
export const removeFromFormOps = (doc: Doc, task: string, fallback: string, key: string): readonly Op[] =>
  editOps(doc, task, fallback, (l) => remove(l, key));
export const stepOps = (doc: Doc, task: string, fallback: string, key: string, by: -1 | 1): readonly Op[] =>
  editOps(doc, task, fallback, (l) => step(l, key, by));
export const columnOps = (
  doc: Doc,
  task: string,
  fallback: string,
  key: string,
  column: Column,
): readonly Op[] => editOps(doc, task, fallback, (l) => setColumn(l, key, column));
export const deletePageOps = (doc: Doc, task: string, fallback: string, index: number): readonly Op[] =>
  editOps(doc, task, fallback, (l) => deletePage(l, index));

/** "Starts a new page" on a field (WP-672): on moves it and the fields after it on its page to a page of their own. */
export const pageBreakOps = (
  doc: Doc,
  task: string,
  fallback: string,
  key: string,
  on: boolean,
): readonly Op[] => editOps(doc, task, fallback, (l) => (on ? startPageAt(l, key) : joinPageAt(l, key)));

/** The page title (`label`) or description (`hint`) of page `index`, in `locale`; empty text removes it. */
export function pageTextOps(
  doc: Doc,
  task: string,
  fallback: string,
  index: number,
  part: 'label' | 'hint',
  locale: string,
  text: string,
): readonly Op[] {
  return editOps(doc, task, fallback, (l) => {
    const now = l.pages[index]?.meta;
    const next = withPage(now, locale, part, text) as { readonly [k: string]: Json };
    const meta: PageMeta = index === 0 && Object.keys(next).length === 0 ? undefined : next;
    return setPageMeta(l, index, meta);
  });
}

/** The text of a page title or description in `locale`, for editing. */
export function pageText(meta: PageMeta, part: 'label' | 'hint', locale: string): string {
  const v = meta?.[part];
  return v === undefined || v === null || (typeof v !== 'string' && typeof v !== 'object')
    ? ''
    : localizeExact(v as never, locale);
}

/** A name for a new property that no property of the type has yet: "Neues Feld", "Neues Feld 2", ... */
export function uniqueName(file: TemplateFile, type: string, locale: string, base: string): string {
  const taken = new Set(
    Object.values(file.types?.[type]?.properties ?? {}).map((p) => localizeExact(p.label as never, locale)),
  );
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  return name;
}

export interface NewField {
  readonly ops: readonly Op[];
  readonly key: string;
}

/**
 * A palette drop of a field type (v3 created a field definition, then placed it): a new property of the type, who may write it
 * (all roles: v3 "Leer = alle"), then it joins the form at `dest`. A long text and an e-mail address are a text
 * property with the form appearance `multiline` or `email`.
 */
export function newFieldOps(
  doc: Doc,
  task: string,
  fallback: string,
  tile: PaletteTile,
  base: string,
  locale: string,
  dest: Dest,
): NewField {
  const file = doc.effective();
  const type = editorModel(file, task, fallback, locale).type;
  const props = file.types?.[type]?.properties ?? {};
  const name = uniqueName(file, type, locale, base);
  const key = slugKey(name, new Set(Object.keys(props)));
  const needsOptions = tile.type === 'select' || tile.type === 'multiselect';
  // The entity selector (v3 default "Tabelle"): a reference to the first table, a participant when there is none.
  const table = tile.entity === true ? tablesOf(file, locale)[0] : undefined;
  const kind = tile.entity === true && table === undefined ? 'participant' : tile.type;
  const create: Op = {
    kind: 'add',
    path: formatKeyPath(['types', type, 'properties', key]),
    value: {
      type: kind,
      label: { [locale]: name },
      ...(needsOptions ? { options: {} } : {}),
      ...(kind === 'reference' && table !== undefined ? { to: table.key } : {}),
    },
  };
  const ops: Op[] = [create];
  let cur = doc.apply(create).doc;
  const audience = setPropertyAudienceOp(cur.effective(), type, 'write', key, { kind: 'all' });
  if (audience !== undefined) {
    ops.push(audience);
    cur = cur.apply(audience).doc;
  }
  for (const op of placeOps(cur, task, fallback, key, dest)) {
    ops.push(op);
    cur = cur.apply(op).doc;
  }
  if (tile.appearance !== undefined)
    ops.push(...setFieldAttrOps(cur, task, key, 'appearance', tile.appearance));
  // A Smart Dropdown starts with an open filter: every option is offered until a Quellfeld is chosen.
  if (tile.smart === true) ops.push(...setFieldAttrOps(cur, task, key, 'choice_filter', 'true'));
  return { ops, key };
}
