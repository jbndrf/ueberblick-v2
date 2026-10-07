import { describe, expect, it } from 'vitest';
import { syncProgress } from './progress';

describe('the header sync progress', () => {
  it('counts features while a snapshot loads and is silent otherwise', () => {
    expect(syncProgress({ phase: 'snapshot', featuresLoaded: 120 })).toBe(120);
    expect(syncProgress({ phase: 'delta', featuresLoaded: 0 })).toBeUndefined();
    expect(syncProgress({ phase: 'idle', featuresLoaded: 500 })).toBeUndefined();
  });
});
