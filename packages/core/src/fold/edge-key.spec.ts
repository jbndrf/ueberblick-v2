import { describe, expect, it } from 'vitest';
import type { FeatureId, Key } from '../model';
import { edgeKey } from './edge-key';

const e = (from: string, relation: string, to: string) => ({
  from: from as FeatureId,
  relation: relation as Key,
  to: to as FeatureId,
});

describe('edgeKey', () => {
  it('is stable and distinguishes from, relation and to', () => {
    expect(edgeKey(e('a', 'r', 'b'))).toBe(edgeKey({ ...e('a', 'r', 'b'), derived: true } as never));
    const keys = new Set(
      [e('a', 'r', 'b'), e('b', 'r', 'a'), e('a', 's', 'b'), e('ar', '', 'b')].map(edgeKey),
    );
    expect(keys.size).toBe(4);
  });
});
