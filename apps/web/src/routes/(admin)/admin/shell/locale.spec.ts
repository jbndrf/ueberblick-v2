import { describe, expect, it } from 'vitest';
import { LOCALE_COOKIE, localeCookie, resolveLocale } from './locale';

describe('resolveLocale', () => {
  it('the cookie wins over Accept-Language', () => {
    expect(resolveLocale('en', 'de-DE,de;q=0.9')).toBe('en');
    expect(resolveLocale('de', 'en-GB')).toBe('de');
  });
  it('without a (valid) cookie: German unless English comes first', () => {
    expect(resolveLocale(undefined, 'en-GB,en;q=0.9')).toBe('en');
    expect(resolveLocale(undefined, 'de-DE')).toBe('de');
    expect(resolveLocale('fr', 'fr')).toBe('de');
    expect(resolveLocale(undefined, null)).toBe('de');
  });
});

describe('localeCookie', () => {
  it('is a one-year, site-wide, same-site cookie', () => {
    const c = localeCookie('en');
    expect(c).toContain(`${LOCALE_COOKIE}=en`);
    expect(c).toContain('path=/');
    expect(c).toContain('max-age=31536000');
    expect(c.toLowerCase()).toContain('samesite=lax');
  });
});
