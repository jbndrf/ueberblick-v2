// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { localeOf } from '../locale-tag';
import { PREF_KEYS } from '../sheets/settings/prefs';
import { LOCALE_KEY, deviceLocale, storeLocale } from './locale';

const clearCookie = () => (document.cookie = 'PARAGLIDE_LOCALE=; path=/; max-age=0');
afterEach(() => {
  localStorage.clear();
  clearCookie();
});

describe('deviceLocale', () => {
  it('is one key for the sign-in page switch and the Einstellungen choice', () => {
    expect(LOCALE_KEY).toBe(PREF_KEYS.locale);
    storeLocale('en');
    expect(deviceLocale()).toBe('en');
    localStorage.setItem(PREF_KEYS.locale, 'de'); // the Optionen choice after sign-in
    expect(deviceLocale()).toBe('de');
  });

  it('without a stored choice the design system cookie, then the browser language, decide', () => {
    document.cookie = 'PARAGLIDE_LOCALE=en; path=/';
    expect(deviceLocale()).toBe('en');
    clearCookie();
    expect(deviceLocale()).toBe(localeOf(navigator.language));
  });
});
