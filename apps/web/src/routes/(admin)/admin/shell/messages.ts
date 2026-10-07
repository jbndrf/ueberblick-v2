/**
 * The admin area's strings: Paraglide messages `admin_*` from `apps/web/messages/{de,en}.json` (same catalogue and
 * compile as the participant app's). German is the default.
 */
import * as m from '../../../../lib/participant/paraglide/messages.js';
import type { Locale } from './locale';

type Prefixed = keyof typeof m;
/** Message keys without the `admin_` prefix. */
export type AdminKey = Prefixed extends infer K ? (K extends `admin_${infer S}` ? S : never) : never;
type Message = (params: Record<string, string | number>, options: { locale: string }) => string;

export function adminMessage(
  locale: Locale,
  key: AdminKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return (m[`admin_${key}` as Prefixed] as unknown as Message)({ ...values }, { locale });
}
