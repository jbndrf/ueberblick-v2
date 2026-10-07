// One `$ref` walker (R1, WP-577 review 1): `embedRefs` is the single walk shared by the golden, e2e and demo
// ingestion; these tests fix its contract.
import { describe, expect, it } from 'vitest';
import { embedRefs } from './embed-refs';

const resolve = (ref: string): unknown =>
  ref === 'a.json'
    ? { $comment: 'a bundle file comment', layers: [{ id: 'x' }] }
    : ref === 'b.json'
      ? { layers: [{ id: 'y' }] }
      : undefined;

describe('embedRefs', () => {
  it('replaces a nested $ref with the resolved JSON', () => {
    const out = embedRefs({ outer: [{ deep: [{ style: { $ref: 'a.json' } }] }] }, resolve);
    expect(out).toEqual({ outer: [{ deep: [{ style: { layers: [{ id: 'x' }] } }] }] });
  });

  it('drops the $comment of the resolved JSON, and only there', () => {
    const out = embedRefs({ $ref: 'a.json' }, resolve) as Record<string, unknown>;
    expect(out.layers).toEqual([{ id: 'x' }]);
    expect(out).not.toHaveProperty('$comment');
    // a $comment that is not the resolved JSON's own top-level key stays
    const kept = embedRefs({ $comment: 'stays', x: { $ref: 'b.json' } }, resolve) as {
      $comment: string;
      x: Record<string, unknown>;
    };
    expect(kept.$comment).toBe('stays');
    expect(kept.x.layers).toEqual([{ id: 'y' }]);
  });

  it('throws when the resolver returns undefined', () => {
    expect(() => embedRefs({ $ref: 'nope.json' }, resolve)).toThrow(/nope\.json/);
  });

  it('does not mutate the input', () => {
    const input = { style: { $ref: 'a.json' }, list: [{ $ref: 'b.json' }] };
    const before = structuredClone(input);
    embedRefs(input, resolve);
    expect(input).toEqual(before);
  });

  it('returns a value without $ref unchanged', () => {
    const value = { a: 1, b: [{ c: 'x' }] };
    expect(embedRefs(value, resolve)).toBe(value);
  });
});
