/**
 * The builder's own UI strings: Paraglide messages (`packages/builder/messages/{en,de}.json`,
 * compiled to `src/paraglide`), the same mechanism as `packages/ui` (R1). Project content uses
 * `LocalizedString`; these are the builder's chrome. A component takes its texts from
 * `messages(locale)` and holds no literal text (`i18n.spec.ts`).
 */
import * as m from '../paraglide/messages.js';

type Prefixed = keyof typeof m;
/** Message keys without the `builder_` prefix. */
export type MessageKey = Prefixed extends infer K ? (K extends `builder_${infer S}` ? S : never) : never;

export type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

type Message = (params: Record<string, string | number>, options: { locale: string }) => string;

/** A translator for `locale` (de or en; anything else falls back to the base locale English). */
export function messages(locale: string): Translate {
  const base = (locale.split('-')[0] ?? locale) === 'de' ? 'de' : 'en';
  return (key, params = {}) =>
    (m[`builder_${key}` as Prefixed] as unknown as Message)({ ...params }, { locale: base });
}
