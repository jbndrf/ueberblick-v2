// WP-443 (A-048): `display_property` of a reference names a property of the target type; `cardinality` on
// reference and participant ("Mehrfachauswahl").
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { TemplateFileSchema } from '../file';
import { PropertySchema } from '../property';
import { compile, NO_ASSETS } from './index';

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const base = (): Record<string, unknown> => parse(Object.values(raw)[0] as string) as Record<string, unknown>;

function withProps(props: Record<string, unknown>) {
  const file = base() as { types: Record<string, { properties: Record<string, unknown> }> };
  const baum = file.types['baum'];
  if (baum === undefined) throw new Error('no baum');
  Object.assign(baum.properties, props);
  return compile(TemplateFileSchema.parse(file), { assets: NO_ASSETS });
}

describe('display_property', () => {
  it('accepts a property of the target type', () => {
    expect(withProps({ selbst: { type: 'reference', to: 'baum', display_property: 'zustaendig' } }).ok).toBe(
      true,
    );
  });

  it('is a compile error when the target has no such property, naming what exists', () => {
    const r = withProps({ selbst: { type: 'reference', to: 'baum', display_property: 'nope' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const p = r.problems.find((x) => x.code === 'dangling_reference');
    expect(p?.path).toBe('types.baum.properties.selbst.display_property');
    expect(p?.params).toMatchObject({ what: 'property_of', of: 'baum', value: 'nope' });
  });
});

describe('cardinality on a property', () => {
  it('is allowed on reference and participant only', () => {
    expect(PropertySchema.safeParse({ type: 'reference', to: 'a', cardinality: 'many' }).success).toBe(true);
    expect(PropertySchema.safeParse({ type: 'participant', cardinality: 'many' }).success).toBe(true);
    expect(PropertySchema.safeParse({ type: 'text', cardinality: 'many' }).success).toBe(false);
    expect(PropertySchema.safeParse({ type: 'participant', display_property: 'x' }).success).toBe(false);
    expect(PropertySchema.safeParse({ type: 'reference', to: 'a', cardinality: 'few' }).success).toBe(false);
  });
});
