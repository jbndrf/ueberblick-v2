// The tool's own strings: Paraglide messages from `../messages/{en,de}.json`, compiled to `./paraglide` (WP-586).
// The host passes the locale; anything that is not German uses English.
import type { GeoValidityIssue } from '@ueberblick/core/registry';
import * as m from './paraglide/messages.js';

type Prefixed = keyof typeof m;
/** Message keys without the `measure_` prefix. */
export type MeasureMessageKey = Prefixed extends infer K
  ? K extends `measure_${infer S}`
    ? S
    : never
  : never;
type Message = (params: Record<string, string | number>, options: { locale: string }) => string;

const localeOf = (locale: string): 'de' | 'en' => (locale.toLowerCase().startsWith('de') ? 'de' : 'en');

export function message(
  locale: string,
  key: MeasureMessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return (m[`measure_${key}` as Prefixed] as unknown as Message)({ ...values }, { locale: localeOf(locale) });
}

/** Issues are keyed by the core.geo validity registry: a new issue key fails to compile until it has words. */
export function issueText(locale: string, issue: GeoValidityIssue): string {
  const key: MeasureMessageKey = `issue_${issue}`;
  return message(locale, key);
}
