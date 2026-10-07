// WP-305: the schema side of the `lifecycle` step.
import { describe, expect, it } from 'vitest';
import { KeyPathSchema } from './primitives';
import { ThenStepSchema } from './task';

describe('lifecycle step schema', () => {
  it('accepts a registry state', () => {
    expect(ThenStepSchema.safeParse({ lifecycle: 'archived' }).success).toBe(true);
    expect(ThenStepSchema.safeParse({ lifecycle: 'completed', when: 'true' }).success).toBe(true);
  });
  it('rejects an unknown state', () => {
    expect(ThenStepSchema.safeParse({ lifecycle: 'gone' }).success).toBe(false);
  });
  it('is one kind: not together with set', () => {
    expect(ThenStepSchema.safeParse({ lifecycle: 'active', set: { a: '1' } }).success).toBe(false);
  });
  it('$lifecycle cannot be a set key', () => {
    expect(KeyPathSchema.safeParse('$lifecycle').success).toBe(false);
    expect(ThenStepSchema.safeParse({ set: { $lifecycle: "'deleted'" } }).success).toBe(false);
  });
});
