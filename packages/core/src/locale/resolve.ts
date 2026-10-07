// The one resolver of a `LocalizedString` (WP-588, R1). Pure: no I/O, no allocation on the hot path.
import type { LocalizedString } from '../schema/primitives';

/** A `LocalizedString` or nothing; the shape every label field of the config has. */
export type Localizable = LocalizedString | undefined;

function pick(map: { readonly [lang: string]: string }, tag: string): string | undefined {
  const exact = map[tag];
  if (exact !== undefined) return exact;
  const dash = tag.indexOf('-');
  return dash > 0 ? map[tag.slice(0, dash)] : undefined;
}

/**
 * Resolves `value` for the ordered preference `locales` (Accept-Language, the UI locale, then any default the
 * caller knows, appended last). Chain (docs/05): for each locale in order its exact tag, then its base language;
 * then the first key present. A plain string is returned as is. Never undefined for a non-empty value; `''` for
 * nothing. There is no project default-locale field: a caller that knows a default appends it to `locales`.
 */
export function localize(value: Localizable, locales: readonly string[]): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  for (const tag of locales) {
    const hit = pick(value, tag);
    if (hit !== undefined) return hit;
  }
  for (const key in value) return value[key] ?? '';
  return '';
}

/**
 * The text stored for one language, for editing it: the exact tag, then its base language, else `''`. Never
 * another language (an English field must not show German text). A plain string counts as every language.
 */
export function localizeExact(value: Localizable | null, locale: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return pick(value, locale) ?? '';
}

/** The language tags of an `Accept-Language` header value, best first (by q, then header order); q=0 dropped. */
export function acceptLocales(header: string | null | undefined): string[] {
  if (header === null || header === undefined) return [];
  const out: { tag: string; q: number; i: number }[] = [];
  header.split(',').forEach((part, i) => {
    const [tagRaw = '', ...params] = part.trim().split(';');
    const tag = tagRaw.trim();
    if (tag === '' || tag === '*') return;
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = qp === undefined ? 1 : Number(qp.slice(2));
    if (Number.isFinite(q) && q > 0) out.push({ tag, q, i });
  });
  return out.sort((a, b) => b.q - a.q || a.i - b.i).map((e) => e.tag);
}
