// WP-374 (A-035): `of` on then-steps, schema side and compile problems.
import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { TemplateFileSchema } from './file';
import { ThenStepSchema } from './task';
import { goldenAssets } from '../testing/golden';

describe('then-step of: schema', () => {
  it('is accepted on lifecycle and set', () => {
    expect(ThenStepSchema.safeParse({ lifecycle: 'deleted', of: 'self.kinder' }).success).toBe(true);
    expect(ThenStepSchema.safeParse({ set: { a: 'null' }, of: 'self.kinder', when: 'true' }).success).toBe(
      true,
    );
  });
  it('is refused on redact (which has its own `of`) and on its own', () => {
    expect(ThenStepSchema.safeParse({ redact: { subject: 'feature' }, of: 'self' }).success).toBe(false);
    expect(ThenStepSchema.safeParse({ of: 'self.kinder' }).success).toBe(false);
  });
});

const base = (then: unknown): unknown => ({
  schema: 'ueberblick/1',
  template: { key: 't', version: '1.0.0' },
  roles: { r: { label: 'R' } },
  types: {
    eltern: {
      label: 'E',
      permissions: { see: '$all', write: '$all' },
      properties: {
        name: { type: 'text' },
        zahl: { type: 'number' },
        haupt: { type: 'reference', to: 'kind' },
      },
      relations: {
        kinder: { to: 'kind', inverse_of: 'kind.eltern', cardinality: 'many' },
      },
    },
    kind: {
      label: 'K',
      permissions: { see: '$all', write: '$all' },
      properties: { name: { type: 'text' }, eltern: { type: 'reference', to: 'eltern' } },
    },
  },
  tasks: { x: { label: 'X', on: 'eltern', then } },
});
const problems = (then: unknown) => {
  const r = compile(TemplateFileSchema.parse(base(then)), { assets: goldenAssets });
  return r.ok ? [] : r.problems;
};

describe('then-step of: compile', () => {
  it('a list of features and a single feature type-check', () => {
    expect(problems([{ lifecycle: 'deleted', of: 'self.kinder' }])).toEqual([]);
    expect(problems([{ set: { name: "'x'" }, of: 'self.haupt' }])).toEqual([]);
  });
  it('a non-feature expression is expression_type at the of path', () => {
    for (const of of ['self.name', 'self.zahl', "'x'", 'true']) {
      const p = problems([{ lifecycle: 'deleted', of }]);
      expect(p.map((x) => x.code)).toEqual(['expression_type']);
      expect(p[0]?.path).toBe('tasks.x.then["0"].of');
    }
  });
  it('set keys must be properties of the target type', () => {
    expect(problems([{ set: { name: "'x'", eltern: null }, of: 'self.kinder' }])).toEqual([]);
    const p = problems([{ set: { zahl: '1' }, of: 'self.kinder' }]);
    expect(p.map((x) => x.code)).toEqual(['dangling_reference']);
  });
  it('a bound-feature key is not allowed with of', () => {
    expect(problems([{ set: { 'a.name': "'x'" }, of: 'self.kinder' }]).map((x) => x.code)).toEqual([
      'expression_type',
    ]);
  });
});
