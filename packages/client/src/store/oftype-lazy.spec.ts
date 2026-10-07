import { describe, expect, it } from 'vitest';
import { MemoryIndex } from './memory';

describe('MemoryIndex.ofType is lazy', () => {
  it('returns an iterator, not an array, and yields nothing for an unknown type', () => {
    const m = new MemoryIndex();
    const it = m.ofType('none' as never);
    expect(Array.isArray(it)).toBe(false);
    expect([...it]).toEqual([]);
  });
});
