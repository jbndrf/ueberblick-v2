/**
 * The route's own strings (login, loading, the sync notice): Paraglide messages from `apps/web/messages/{de,en}.json`,
 * compiled to `./paraglide` (WP-586). The design system's strings live in `packages/ui`; the tools carry theirs.
 * German is the default, English the alternative; a key exists in both or the catalogue test fails.
 */

import type * as Catalogue from './paraglide/messages.js';

/**
 * Only the `participant_*` message files are imported: a namespace import of `./paraglide/messages.js` plus a dynamic
 * key keeps every message of the catalogue (the admin area's 1,300 included) in the participant shell (WP-827).
 */
const files = import.meta.glob<Record<string, unknown>>('./paraglide/messages/participant_*.js', {
  eager: true,
});
const m: Record<string, unknown> = Object.assign({}, ...Object.values(files));

export type Locale = 'de' | 'en';

type Prefixed = keyof typeof Catalogue;
/** Message keys without the `participant_` prefix. */
export type MessageKey = Prefixed extends infer K ? (K extends `participant_${infer S}` ? S : never) : never;
type Message = (params: Record<string, string | number>, options: { locale: string }) => string;

export function message(
  locale: Locale,
  key: MessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return (m[`participant_${key}`] as Message)({ ...values }, { locale });
}
