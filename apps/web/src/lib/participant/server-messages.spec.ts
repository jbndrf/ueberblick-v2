import { describe, expect, it } from 'vitest';
import { message as full } from './messages';
import { message, type ServerMessageKey } from './server-messages';

const keys: readonly ServerMessageKey[] = ['join_failed', 'join_not_found', 'join_throttled'];

describe('server-messages', () => {
  it.each(keys.flatMap((k) => (['de', 'en'] as const).map((l) => [k, l] as const)))(
    '%s in %s equals the full catalogue',
    (key, locale) => {
      expect(message(locale, key)).toBe(full(locale, key));
      expect(message(locale, key).length).toBeGreaterThan(0);
    },
  );
});
