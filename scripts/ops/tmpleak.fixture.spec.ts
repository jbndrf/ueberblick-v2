import { expect, it } from 'vitest';

// Runs only when the guardrail (tmp-leak.spec.ts) starts vitest on this file.
it('is a trivial test that makes vitest create its scratch directory', () => {
  expect(1 + 1).toBe(2);
});
