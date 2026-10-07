/**
 * The admin's own columns (v3 "Benutzerdefinierte Felder"): how a typed Feldname becomes a column key, and the list
 * after an add. The server stores the whole list (`PUT participants/columns`), so every change is
 * a new array; the array order is the column order.
 */
import { definitionOf, type ColumnForm } from '../columns/form';
import type { CustomColumn } from './types';

/** Keys the roster keeps for itself (`FIXED_ATTRS` of the server): a column may not use them. */
const RESERVED = ['email', 'phone'] as const;

/** A key from the typed name: `^[a-z][a-z0-9_]*$`, unique among `taken` (v3 asked for such a name by hand). */
export function columnKeyOf(label: string, taken: ReadonlySet<string>): string {
  const slug = label
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = slug === '' ? 'feld' : /^[a-z]/.test(slug) ? slug : `f_${slug}`;
  const used = (k: string): boolean => taken.has(k) || (RESERVED as readonly string[]).includes(k);
  let key = base;
  for (let n = 2; used(key); n++) key = `${base}_${n}`;
  return key;
}

/** The list after adding a column. */
export function withAdded(list: readonly CustomColumn[], form: ColumnForm): CustomColumn[] {
  const key = columnKeyOf(form.label, new Set(list.map((c) => c.key)));
  return [...list, definitionOf(key, form)];
}
