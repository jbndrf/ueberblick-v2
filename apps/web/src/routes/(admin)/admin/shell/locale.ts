/**
 * The admin area's language. v3 kept the choice from its language switcher; v4's server reads only Accept-Language, so
 * the switcher writes a cookie and the admin layout reads it first.
 */
import { localeOf } from '../../../../lib/participant/locale-tag';
import type { Locale } from '../../../../lib/participant/messages';

export type { Locale };
export const LOCALE_COOKIE = 'ub_locale';
const YEAR_S = 365 * 24 * 60 * 60;

/** The cookie wins when it holds a known language; otherwise German unless English comes first. */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (cookie === 'de' || cookie === 'en') return cookie;
  return localeOf((acceptLanguage ?? '').trim());
}

/** The `document.cookie` string for a chosen language. */
export const localeCookie = (locale: Locale): string =>
  `${LOCALE_COOKIE}=${locale}; path=/; max-age=${YEAR_S}; SameSite=Lax`;
