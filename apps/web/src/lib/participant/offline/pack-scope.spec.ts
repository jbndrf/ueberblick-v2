import { describe, expect, it } from 'vitest';
import { packScopeFromName } from './pack-scope';

describe('packScopeFromName', () => {
  it('returns the scope when both params are present', () => {
    expect(packScopeFromName('project=p1&participant=u1')).toEqual({
      project: 'p1',
      participant: 'u1',
    });
  });
  it('throws when a param is missing or empty', () => {
    expect(() => packScopeFromName('participant=u1')).toThrow(/project/);
    expect(() => packScopeFromName('project=p1')).toThrow(/participant/);
    expect(() => packScopeFromName('project=&participant=u1')).toThrow(/project/);
    expect(() => packScopeFromName('project=p1&participant=')).toThrow(/participant/);
  });
});
