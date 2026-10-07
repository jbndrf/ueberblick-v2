/**
 * The relative time of a timeline row, as v3's `relativeTime` (Module:498): the header's "gerade eben / vor 5 Min /
 * vor 2 Std", then "Gestern" for exactly one day back, then "vor 3 Tg" up to a week, then the date. `now` is the
 * clock port's.
 */
import type { Instant } from '@ueberblick/core/model';
import { message, type Locale } from '../../messages';
import { ago } from '../ago';

const DAY_S = 86_400;

export function when(at: Instant, now: Instant, locale: Locale): string {
  const seconds = Math.floor((Date.parse(now) - Date.parse(at)) / 1000);
  return seconds >= DAY_S && seconds < 2 * DAY_S ? message(locale, 'ago_yesterday') : ago(at, now, locale);
}
