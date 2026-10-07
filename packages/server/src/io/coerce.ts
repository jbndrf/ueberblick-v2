/** Source cell -> property value, by the property type (a CSV cell is text; GeoJSON and GeoPackage bring types). */
import type { Json, LocalizedString } from '@ueberblick/core';
import { parseNumber } from './read-csv';

const TRUE = new Set(['true', '1', 'ja', 'yes', 'wahr', 'j', 'y']);
const FALSE = new Set(['false', '0', 'nein', 'no', 'falsch', 'n']);

export type Coerced =
  { readonly ok: true; readonly value: Json | undefined } | { readonly ok: false; readonly message: string };

const ok = (value: Json | undefined): Coerced => ({ ok: true, value });
const bad = (message: string): Coerced => ({ ok: false, message });
const nfc = (s: string): string => s.normalize('NFC');

/** What a cell needs besides its text: the roles of the project (key to label) and the property's cardinality. */
export interface CoerceContext {
  readonly language?: string;
  readonly roles?: Readonly<Record<string, { readonly label: LocalizedString }>>;
  readonly cardinality?: string;
}

/** A role cell names a role by its key or by its label in any language (case-insensitive); an unknown one is refused. */
function coerceRole(raw: Json, ctx: CoerceContext): Coerced {
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('|') : undefined;
  if (items === undefined || !items.every((i) => typeof i === 'string')) return bad('not a list of roles');
  const roles = ctx.roles ?? {};
  const keys: string[] = [];
  for (const item of items as string[]) {
    const name = nfc(item.trim());
    if (name === '') continue;
    const lower = name.toLowerCase();
    const key = Object.hasOwn(roles, name)
      ? name
      : Object.keys(roles).find((k) =>
          Object.values(roles[k]?.label ?? {}).some(
            (l) => typeof l === 'string' && nfc(l).toLowerCase() === lower,
          ),
        );
    if (key === undefined) return bad(`'${name}' is not a role of this project`);
    keys.push(key);
  }
  if (keys.length === 0) return ok(undefined);
  return ctx.cardinality === 'many' ? ok(keys) : keys.length === 1 ? ok(keys[0]) : bad('more than one role');
}

/** `value: undefined` means "no value" (an empty cell): the field is left out of the run input. */
export function coerce(type: string, raw: Json | undefined, ctx: CoerceContext | string = {}): Coerced {
  const c: CoerceContext = typeof ctx === 'string' ? { language: ctx } : ctx;
  const language = c.language;
  if (raw === undefined || raw === null) return ok(undefined);
  if (typeof raw === 'string' && raw.trim() === '') return ok(undefined);
  switch (type) {
    case 'number':
    case 'integer': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseNumber(raw) : undefined;
      if (n === undefined || !Number.isFinite(n)) return bad('not a number');
      if (type === 'integer' && !Number.isInteger(n)) return bad('not a whole number');
      return ok(n);
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return ok(raw);
      const t =
        typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      return TRUE.has(t) ? ok(true) : FALSE.has(t) ? ok(false) : bad('not true or false');
    }
    case 'localized_text':
      if (language === undefined) return bad('a localized text needs a language in the mapping');
      return typeof raw === 'string' ? ok({ [language]: nfc(raw) }) : bad('not text');
    case 'multiselect': {
      const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('|') : undefined;
      return items !== undefined && items.every((i) => typeof i === 'string')
        ? ok(items.map((i) => nfc((i as string).trim())))
        : bad('not a list of options');
    }
    case 'role':
      return coerceRole(raw, c);
    case 'geometry':
      return bad('a geometry comes from the geometry mapping, not from a column');
    default:
      return typeof raw === 'string'
        ? ok(nfc(raw))
        : typeof raw === 'number'
          ? ok(String(raw))
          : bad('not text');
  }
}
