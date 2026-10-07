// WP-835: datetime-local <-> instant at the form boundary, and date prefill typing.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Property } from '../schema/property';
import { instantToLocal, localToInstant, typedForProperty } from './datetime';
import { typeFits } from './type';

const datetime = { type: 'datetime' } as Property;

describe('datetime input', () => {
  it('UTC: the local text becomes a valid instant', () => {
    const v = localToInstant('2026-05-01T10:30', 0);
    expect(v).toBe('2026-05-01T10:30:00.000Z');
    expect(typeFits(datetime, v)).toBe(true);
    expect(typeFits(datetime, '2026-05-01T10:30')).toBe(false);
  });

  it('non-UTC: Berlin summer (+120) and New York (-300), across midnight', () => {
    expect(localToInstant('2026-05-01T10:30', 120)).toBe('2026-05-01T08:30:00.000Z');
    expect(localToInstant('2026-05-01T00:15', 120)).toBe('2026-04-30T22:15:00.000Z');
    expect(localToInstant('2026-05-01T22:30', -300)).toBe('2026-05-02T03:30:00.000Z');
    expect(instantToLocal('2026-05-01T08:30:00.000Z', 120)).toBe('2026-05-01T10:30');
    expect(instantToLocal('2026-05-02T03:30:00.000Z', -300)).toBe('2026-05-01T22:30');
  });

  it('empty and non-matching text pass through; a local text is not re-shifted', () => {
    expect(localToInstant('', 120)).toBe('');
    expect(instantToLocal('', 120)).toBe('');
    expect(instantToLocal('2026-05-01T10:30', 120)).toBe('2026-05-01T10:30');
  });

  it('round-trips for any offset (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000 }),
        fc.integer({ min: -12 * 60, max: 14 * 60 }),
        (sec, off) => {
          const local = new Date(sec * 1000 + off * 60_000).toISOString().slice(0, 16);
          const instant = localToInstant(local, off);
          return typeFits(datetime, instant) && instantToLocal(instant, off) === local;
        },
      ),
    );
  });
});

describe('prefill typing', () => {
  it('a date property keeps the calendar date of a timestamp', () => {
    expect(typedForProperty('date', '2026-10-05T00:00:00.000Z')).toBe('2026-10-05');
    expect(typedForProperty('date', '2026-10-05')).toBe('2026-10-05');
  });
  it('a datetime property and other types keep the value', () => {
    expect(typedForProperty('datetime', '2026-10-05T00:00:00.000Z')).toBe('2026-10-05T00:00:00.000Z');
    expect(typedForProperty('text', '2026-10-05T00:00:00.000Z')).toBe('2026-10-05T00:00:00.000Z');
    expect(typedForProperty(undefined, 5)).toBe(5);
  });
});
