/**
 * The participant's language, stored on the device (v3: the language switch on the sign-in page and Optionen). One key
 * for both, the one the Einstellungen preferences use (`PREF_KEYS.locale`), so a choice made at sign-in is the one the
 * app shows and a choice in Optionen is the one the sign-in page shows next time.
 */
import { localeOf } from '../locale-tag';
import type { Locale } from '../messages';

export const LOCALE_KEY = 'ub:locale';

/** The language the participant chose on this device, if any. */
export function storedLocale(): Locale | undefined {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    // storage unavailable: follow the browser
  }
  return undefined;
}

/** The design system's cookie (its Paraglide strategy reads it); set whenever the person's language is applied. */
function cookieLocale(): Locale | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = /(?:^|;\s*)PARAGLIDE_LOCALE=(de|en)(?:;|$)/.exec(document.cookie);
  return m === null ? undefined : (m[1] as Locale);
}

/** The person's own pick, else the cookie of a former visit, else the language of the browser. */
export function deviceLocale(): Locale {
  const stored = storedLocale() ?? cookieLocale();
  if (stored !== undefined) return stored;
  return localeOf(typeof navigator === 'undefined' ? 'de' : navigator.language);
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // the choice then lasts for this page only
  }
  document.documentElement.lang = locale;
  document.cookie = `PARAGLIDE_LOCALE=${locale}; path=/; max-age=31536000; samesite=lax`;
}
