import { describe, expect, it } from 'vitest';
import { ACTOR_KINDS } from './actor-kinds';

describe('registry', () => {
  it('exposes keys and lookup', () => {
    expect(ACTOR_KINDS.keys).toEqual(['participant', 'admin', 'system', 'import']);
    expect(ACTOR_KINDS.has('system')).toBe(true);
    expect(ACTOR_KINDS.has('robot')).toBe(false);
    expect(ACTOR_KINDS.get('import').description).toMatch(/import/i);
  });
});
