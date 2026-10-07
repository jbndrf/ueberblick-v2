// The tool's own strings: Paraglide messages from `../messages/{en,de}.json`, compiled to `./paraglide` (WP-586).
// The host passes the locale; anything that is not German uses English.
import * as m from './paraglide/messages.js';

type Prefixed = keyof typeof m;
/** Message keys without the `search_` prefix. */
export type SearchMessageKey = Prefixed extends infer K ? (K extends `search_${infer S}` ? S : never) : never;
type Message = (params: Record<string, string | number>, options: { locale: string }) => string;

const localeOf = (locale: string): 'de' | 'en' => (locale.toLowerCase().startsWith('de') ? 'de' : 'en');

export function message(
  locale: string,
  key: SearchMessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return (m[`search_${key}` as Prefixed] as unknown as Message)({ ...values }, { locale: localeOf(locale) });
}
