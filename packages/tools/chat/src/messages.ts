// The tool's own strings: Paraglide messages from `../messages/{en,de}.json`, compiled to `./paraglide` (WP-586).
// The host passes the locale; anything that is not German uses English.
import * as m from './paraglide/messages.js';

type Prefixed = keyof typeof m;
/** Message keys without the `chat_` prefix. */
export type ChatMessageKey = Prefixed extends infer K ? (K extends `chat_${infer S}` ? S : never) : never;
type Message = (params: Record<string, string | number>, options: { locale: string }) => string;

const localeOf = (locale: string): 'de' | 'en' => (locale.toLowerCase().startsWith('de') ? 'de' : 'en');

export type Translate = (key: ChatMessageKey, values?: Readonly<Record<string, string | number>>) => string;

export const translator =
  (locale: string): Translate =>
  (key, values = {}) =>
    (m[`chat_${key}` as Prefixed] as unknown as Message)({ ...values }, { locale: localeOf(locale) });
