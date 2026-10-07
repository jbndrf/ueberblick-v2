import { describe, expect, it } from 'vitest';
import { ATTACHMENT, relationLabel } from './labels';

describe('relation labels', () => {
  it('an unknown key shows as itself', () => {
    expect(relationLabel('de', ATTACHMENT, 'zzz')).toBe('zzz');
  });
});
