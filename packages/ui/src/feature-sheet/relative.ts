import type { Instant } from '@ueberblick/core/model';
import { m } from '../paraglide/messages.js';
import { messageLocale, relativeFormat } from './format';

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "3 days ago", localized. `now` comes from the clock port; this never reads a clock itself. */
export function relativeTime(at: Instant, now: Instant, locale: string): string {
  const seconds = (Date.parse(at) - Date.parse(now)) / 1000;
  if (Number.isNaN(seconds)) return at;
  const abs = Math.abs(seconds);
  for (const [unit, size] of UNITS) {
    if (abs >= size) return relativeFormat(locale).format(Math.trunc(seconds / size), unit);
  }
  return m.ui_feature_sheet_now({}, { locale: messageLocale(locale) });
}
