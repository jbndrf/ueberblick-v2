import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Instant } from '@ueberblick/core/model';
import { ago } from './ago';

const NOW = '2026-10-01T12:00:00Z' as Instant;
const before = (seconds: number): Instant =>
  new Date(Date.parse(NOW) - seconds * 1000).toISOString() as Instant;

describe('ago (v3 header wording)', () => {
  it('steps from now through minutes, hours and days to a date', () => {
    expect(ago(before(30), NOW, 'de')).toBe('gerade eben');
    expect(ago(before(5 * 60), NOW, 'de')).toBe('vor 5 Min');
    expect(ago(before(2 * 3600), NOW, 'de')).toBe('vor 2 Std');
    expect(ago(before(3 * 86400), NOW, 'de')).toBe('vor 3 Tg');
    expect(ago(before(10 * 86400), NOW, 'de')).toBe('21.9.2026');
    expect(ago(before(2 * 3600), NOW, 'en')).toBe('2h ago');
    expect(ago(before(10 * 86400), NOW, 'en')).toBe('9/21/2026');
  });

  it('the date follows the app language, whatever the browser says', () => {
    expect(ago(before(10 * 86400), NOW, 'en')).toBe('9/21/2026');
    expect(ago(before(10 * 86400), NOW, 'de')).toBe('21.9.2026');
  });

  it('an unreadable time gives nothing', () => {
    expect(ago('nope' as Instant, NOW, 'de')).toBe('');
  });

  it('never throws and always says something for a past time', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 * 86400 }), fc.constantFrom('de', 'en'), (s, l) => {
        expect(ago(before(s), NOW, l).length).toBeGreaterThan(0);
      }),
    );
  });
});
