// @vitest-environment node
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Rule {
  name: string;
  from: { pathNot?: string };
  to: { path?: string };
}

// `npm run boundaries` enforces the rule; this pins its shape so it cannot be loosened unnoticed.
describe('no-testing-helpers-in-prod', () => {
  const config = createRequire(import.meta.url)(join(__dirname, '../../../../.dependency-cruiser.cjs')) as {
    forbidden: Rule[];
  };
  const rule = config.forbidden.find((r) => r.name === 'no-testing-helpers-in-prod');

  it('forbids production code from importing *.testing.ts, and exempts specs and helpers', () => {
    expect(rule).toBeDefined();
    const target = new RegExp(rule?.to.path ?? '(?!)');
    const exempt = new RegExp(rule?.from.pathNot ?? '(?!)');
    expect(target.test('packages/ui/src/form/form.testing.ts')).toBe(true);
    expect(target.test('packages/ui/src/form/session.ts')).toBe(false);
    expect(exempt.test('packages/ui/src/form/session.spec.ts')).toBe(true);
    expect(exempt.test('packages/ui/src/form/form.testing.ts')).toBe(true);
    expect(exempt.test('packages/ui/src/form/session.ts')).toBe(false);
  });
});
