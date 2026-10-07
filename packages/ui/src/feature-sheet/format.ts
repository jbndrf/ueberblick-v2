// Readable values per property type. Total over the property type registry (see `FORMATTERS`).
import type {
  Derived,
  FeatureId,
  FeatureType,
  Json,
  Key,
  Property,
  PropertyTypeKey,
} from '@ueberblick/core/model';
import { m } from '../paraglide/messages.js';
import { localize } from '../form/localize';
import { fileRefs, type GalleryFile } from '../form/gallery/files';
import type { FeatureSheetLookups } from './contract';

/** The languages of the message files; any other tag falls back to English. */
export function messageLocale(locale: string): 'en' | 'de' {
  return locale.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export interface FormatContext {
  readonly locale: string;
  readonly timeZone?: string | undefined;
  readonly lookups: FeatureSheetLookups;
  readonly derived: { readonly [property: string]: Derived };
  readonly key: Key;
}

export interface Formatted {
  readonly text: string;
  readonly files?: readonly GalleryFile[];
  /** `select`/`multiselect`: one label per chosen option, in the option order of the property. */
  readonly badges?: readonly string[];
  readonly links?: readonly { readonly id: FeatureId; readonly label: string }[];
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>(
  id: string,
  make: () => T,
): T {
  let hit = cache.get(id) as T | undefined;
  if (hit === undefined) {
    hit = make();
    cache.set(id, hit);
  }
  return hit;
}

export function numberFormat(locale: string): Intl.NumberFormat {
  return cached(`n|${locale}`, () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }));
}

export function relativeFormat(locale: string): Intl.RelativeTimeFormat {
  return cached(`r|${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
}

function dateFormat(locale: string, timeZone: string | undefined, withTime: boolean): Intl.DateTimeFormat {
  return cached(
    `d|${locale}|${timeZone ?? ''}|${withTime}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        ...(withTime ? { timeStyle: 'short' } : {}),
        ...(timeZone !== undefined ? { timeZone } : {}),
      }),
  );
}

const isText = (v: Json | undefined): v is string => typeof v === 'string';
const list = (v: Json | undefined): readonly Json[] =>
  Array.isArray(v) ? (v as readonly Json[]) : v == null ? [] : [v];

function date(v: Json, ctx: FormatContext, withTime: boolean): Formatted | undefined {
  if (!isText(v)) return undefined;
  // A calendar date has no zone: read it as UTC so it never shifts a day.
  const at = new Date(withTime ? v : `${v}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return { text: v };
  return { text: dateFormat(ctx.locale, withTime ? ctx.timeZone : 'UTC', withTime).format(at) };
}

function optionLabel(p: Property, key: string, locale: string): string {
  // Own keys only: a value such as `constructor` must not find an inherited member.
  const label = p.options !== undefined && Object.hasOwn(p.options, key) ? p.options[key] : undefined;
  return label === undefined ? key : localize(label, locale);
}

/**
 * Order `selected` by the position in `canonical` (the options as declared, v3 `option-order.ts`). A value without an
 * option (its option was removed) keeps its relative order and goes last, so nothing is dropped.
 */
export function orderByOptions(selected: readonly string[], canonical: readonly string[]): string[] {
  const rank = new Map<string, number>();
  canonical.forEach((key, i) => {
    if (!rank.has(key)) rank.set(key, i);
  });
  return selected
    .map((value, i) => ({ value, i, r: rank.get(value) ?? canonical.length }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.value);
}

function geometrySummary(ctx: FormatContext): string {
  const d = ctx.derived[ctx.key];
  const lm = { locale: messageLocale(ctx.locale) };
  if (d !== undefined && d.areaM2 > 0)
    return m.ui_feature_sheet_area({ value: numberFormat(ctx.locale).format(d.areaM2) }, lm);
  if (d !== undefined && d.lengthM > 0)
    return m.ui_feature_sheet_length({ value: numberFormat(ctx.locale).format(d.lengthM) }, lm);
  return m.ui_feature_sheet_point({}, lm);
}

function localizedText(v: { readonly [k: string]: Json }, locale: string): string {
  const strings = Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => isText(e[1])));
  return Object.keys(strings).length > 0 ? localize(strings, locale) : JSON.stringify(v);
}

/** `undefined` means the value does not match the property type: shown like an empty value. */
type Formatter = (v: Json, p: Property, ctx: FormatContext) => Formatted | undefined;
const isObject = (v: Json): v is { readonly [k: string]: Json } =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
/** Every element of a list value passes `ok`, else the whole value is malformed. */
const listOf = <T extends Json>(v: Json, ok: (x: Json) => x is T): readonly T[] | undefined => {
  const items = list(v);
  return items.every(ok) ? (items as readonly T[]) : undefined;
};

/** One formatter per property type; a spec fails when a registered type has none. */
export const FORMATTERS: { readonly [K in PropertyTypeKey]: Formatter } = {
  text: (v) => (isText(v) ? { text: v } : undefined),
  localized_text: (v, _p, ctx) =>
    isText(v) ? { text: v } : isObject(v) ? { text: localizedText(v, ctx.locale) } : undefined,
  number: (v, _p, ctx) => (typeof v === 'number' ? { text: numberFormat(ctx.locale).format(v) } : undefined),
  integer: (v, _p, ctx) => (typeof v === 'number' ? { text: numberFormat(ctx.locale).format(v) } : undefined),
  boolean: (v, _p, ctx) => {
    const lm = { locale: messageLocale(ctx.locale) };
    if (v === true) return { text: m.ui_feature_sheet_yes({}, lm) };
    return v === false ? { text: m.ui_feature_sheet_no({}, lm) } : undefined;
  },
  date: (v, _p, ctx) => date(v, ctx, false),
  datetime: (v, _p, ctx) => date(v, ctx, true),
  time: (v) => (isText(v) ? { text: v } : undefined),
  select: (v, p, ctx) => {
    if (!isText(v)) return undefined;
    const text = optionLabel(p, v, ctx.locale);
    return { text, badges: [text] };
  },
  multiselect: (v, p, ctx) => {
    const items = listOf(v, isText);
    if (!items) return undefined;
    const badges = orderByOptions(items, Object.keys(p.options ?? {})).map((x) =>
      optionLabel(p, x, ctx.locale),
    );
    return { text: badges.join(', '), badges };
  },
  geometry: (_v, _p, ctx) => ({ text: geometrySummary(ctx) }),
  participant: (v, _p, ctx) => {
    const items = listOf(v, isText);
    // A person the device has no name for is "Jemand", never the id (WP-306 owner decision, v3 `activity_unknown_actor`).
    const unknown = m.ui_feature_sheet_unknown_person({}, { locale: messageLocale(ctx.locale) });
    return items && { text: items.map((x) => ctx.lookups.participant(x) ?? unknown).join(', ') };
  },
  role: (v, _p, ctx) => {
    const items = listOf(v, isText);
    return items && { text: items.map((x) => ctx.lookups.role?.(x) ?? x).join(', ') };
  },
  reference: (v, _p, ctx) => {
    const items = listOf(v, isText);
    if (!items) return undefined;
    const links = items.map((x) => ({
      id: x as FeatureId,
      label: ctx.lookups.feature(x as FeatureId)?.label ?? x,
    }));
    return { text: links.map((l) => l.label).join(', '), links };
  },
  file: (v, _p, ctx) => {
    const files = fileRefs(v);
    const lm = { locale: messageLocale(ctx.locale) };
    const text =
      files.length === 1
        ? m.ui_feature_sheet_file_one({}, lm)
        : m.ui_feature_sheet_files({ count: files.length }, lm);
    return { text, files };
  },
};

/** The readable value of one property; `undefined` when the feature has no value for it. */
export function formatProperty(
  value: Json | undefined,
  property: Property,
  ctx: FormatContext,
): Formatted | undefined {
  if (value === undefined || value === null) return undefined;
  const shown = FORMATTERS[property.type](value, property, ctx);
  if (shown === undefined && import.meta.env?.DEV)
    console.warn(`feature sheet: a value does not match property type ${property.type}`);
  return shown;
}

/** The label of a property in the locale, the key when it has none. */
export function propertyLabel(type: FeatureType, key: Key, locale: string): string {
  const label = type.properties[key]?.label;
  return label === undefined ? key : localize(label, locale);
}
