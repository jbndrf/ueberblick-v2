// The tool's own strings: Paraglide messages from `../messages/{en,de}.json`, compiled to `./paraglide`.
// The host passes the locale; anything that is not German uses English.
import * as m from './paraglide/messages.js';

type Prefixed = keyof typeof m;
/** Message keys without the `file_` prefix. */
export type FileMessageKey = Prefixed extends infer K ? (K extends `file_${infer S}` ? S : never) : never;
type Message = (params: Record<string, string | number>, options: { locale: string }) => string;

export function message(locale: string, key: FileMessageKey): string {
  const de = locale.toLowerCase().startsWith('de');
  return (m[`file_${key}` as Prefixed] as unknown as Message)({}, { locale: de ? 'de' : 'en' });
}
