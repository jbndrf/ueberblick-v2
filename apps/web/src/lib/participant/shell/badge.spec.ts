import { describe, expect, it } from 'vitest';
import { badgeText, NO_BADGE, sumBadges } from './badge';

describe('the Werkzeuge badge', () => {
  it('adds the hard counts of the active tools and shows a soft dot when any is soft', () => {
    const b = {
      chat: { hard: 3, soft: true },
      search: { hard: 2, soft: false },
      off: { hard: 9, soft: true },
    };
    expect(sumBadges(b, ['chat', 'search'], false)).toEqual({ hard: 5, soft: true });
    expect(sumBadges({ chat: { hard: 0, soft: true } }, ['chat'], false)).toEqual({ hard: 0, soft: true });
    expect(sumBadges(b, [], false)).toEqual(NO_BADGE);
  });

  it('is cleared while the Werkzeuge sheet is open', () => {
    expect(sumBadges({ chat: { hard: 3, soft: true } }, ['chat'], true)).toEqual(NO_BADGE);
  });

  it('writes 99+ above 99', () => {
    expect([1, 99, 100, 250].map(badgeText)).toEqual(['1', '99', '99+', '99+']);
  });
});
