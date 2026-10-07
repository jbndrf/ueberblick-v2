import { localize } from '@ueberblick/core/locale';
import type { Json } from './contract';

type Texts = { [locale: string]: string };

/** The strings of a `localized_text` value; anything else (a bare string, a malformed value) holds none. */
function textsOf(value: Json | undefined): Texts {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

/** What a `localized_text` input shows: the read view's chain (`localize` of core: the locale, its base
 * language, then the first stored language). */
export function localizedShown(value: Json | undefined, locale: string): string {
  if (typeof value === 'string') return value;
  return localize(textsOf(value), [locale]);
}

/** The value after the participant typed `text` for `locale`: `{ ...existing, [locale]: text }`. An empty
 * text removes only that locale's entry; no entry left is `null`, which clears the property like any
 * other emptied field (`isEmptyValue` of core.form, the clearing rule of `session.clearing()`). */
export function localizedWith(value: Json | undefined, locale: string, text: string): Json {
  const rest = Object.fromEntries(Object.entries(textsOf(value)).filter(([k]) => k !== locale));
  const next: Texts = text === '' ? rest : { ...rest, [locale]: text };
  return Object.keys(next).length > 0 ? next : null;
}
