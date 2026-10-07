/**
 * "vor 2 Std" for the header subtitle, as v3's `instanceLabel` wrote it (reference/src/lib/utils/instance-label.ts:113):
 * seconds -> "gerade eben", then minutes, hours, days up to a week, then the date. `now` comes from the clock port.
 */
import type { Instant } from '@ueberblick/core/model';
import { message, type Locale } from '../messages';

const WEEK_DAYS = 7;

export function ago(at: Instant, now: Instant, locale: Locale): string {
  const then = Date.parse(at);
  const seconds = Math.floor((Date.parse(now) - then) / 1000);
  if (Number.isNaN(seconds)) return '';
  if (seconds < 60) return message(locale, 'ago_now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return message(locale, 'ago_minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return message(locale, 'ago_hours', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < WEEK_DAYS) return message(locale, 'ago_days', { count: days });
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).format(then);
}
