import { describe, expect, it } from 'vitest';
import { EXPR_TYPE_KINDS, TOKEN_KINDS } from '.';

describe('expr kind registries', () => {
  it('are exported from the registry index', () => {
    expect(EXPR_TYPE_KINDS.keys).toContain('dyn');
    expect(TOKEN_KINDS.keys).toContain('eof');
  });
});
