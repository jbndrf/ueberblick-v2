import { describe, expect, it } from 'vitest';
import { availableToolKeys } from './data';

describe('tool data glue', () => {
  it('lists only the tools the availability rule gives the person', () => {
    const availability = (k: string) =>
      k === 'chat' ? ('offered' as const) : k === 'search' ? ('active' as const) : undefined;
    expect(availableToolKeys(availability, ['chat', 'search', 'ghost'])).toEqual(['chat', 'search']);
    expect(availableToolKeys(() => undefined, ['chat'])).toEqual([]);
  });
});
