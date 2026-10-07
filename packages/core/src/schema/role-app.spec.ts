import { describe, expect, it } from 'vitest';
import { RoleAppSchema } from './index';

describe('RoleAppSchema.activity_names', () => {
  it('is an optional boolean', () => {
    expect(RoleAppSchema.safeParse({}).success).toBe(true);
    expect(RoleAppSchema.safeParse({ activity_names: false }).success).toBe(true);
    expect(RoleAppSchema.safeParse({ activity_names: 'no' }).success).toBe(false);
  });
});
