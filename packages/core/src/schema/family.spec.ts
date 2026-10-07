// WP-677 (B-019): a relation declares its child's position as inherited (`inherit_position`), and compile refuses a
// child type that also has a position of its own.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { goldenAssets } from '../testing/golden';
import { TemplateFileSchema, type TemplateFile } from './file';
import { RelationSchema } from './property';
import { inheritRelations } from './relation-cardinality';
import { compile } from './compile';

const raw = import.meta.glob('./compile/__fixtures__/base.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const base = (): Record<string, unknown> => parse(Object.values(raw)[0] as string) as Record<string, unknown>;

/** The base file plus a `massnahme` type that points at a baum and a baum relation that lists them. */
function withChild(over: {
  childGeometry?: boolean;
  inherit?: boolean;
  property?: Record<string, unknown>;
}): TemplateFile {
  const f = base() as { types: Record<string, Record<string, unknown>> };
  const props: Record<string, unknown> = {
    baum: over.property ?? { type: 'reference', to: 'baum', required: true },
    was: { type: 'text' },
  };
  if (over.childGeometry) props['ort'] = { type: 'geometry', geometry_type: 'point' };
  f.types['massnahme'] = {
    label: { de: 'Maßnahme' },
    ...(over.childGeometry ? { geometry: 'ort' } : {}),
    properties: props,
  };
  (f.types['baum'] as { relations: Record<string, unknown> }).relations['massnahmen'] = {
    to: 'massnahme',
    inverse_of: 'massnahme.baum',
    ...(over.inherit === false ? {} : { inherit_position: true }),
  };
  return TemplateFileSchema.parse(f);
}
const run = (f: TemplateFile) => compile(f, { assets: goldenAssets });

describe('inherit_position on a relation', () => {
  it('the schema accepts it on an inverse_of relation', () => {
    expect(RelationSchema.safeParse({ to: 'm', inverse_of: 'm.baum', inherit_position: true }).success).toBe(
      true,
    );
  });
  it('the schema refuses it on a relation that is not an inverse', () => {
    const r = RelationSchema.safeParse({ to: 'm', derive: 'true', inherit_position: true });
    expect(r.success).toBe(false);
  });
  it('compile accepts a child type with no geometry of its own', () => {
    expect(run(withChild({})).ok).toBe(true);
  });
  it('compile refuses a child type that has its own primary geometry', () => {
    const r = run(withChild({ childGeometry: true }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const p = r.problems.find((x) => x.code === 'inherit_with_own_geometry');
    expect(p?.path).toBe('types.baum.relations.massnahmen.inherit_position');
  });
  it('without the flag a child with its own geometry stays valid', () => {
    expect(run(withChild({ childGeometry: true, inherit: false })).ok).toBe(true);
  });
  it('compile refuses a flag whose child property is not a reference to the parent type', () => {
    const r = run(withChild({ property: { type: 'text' } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.some((x) => x.code === 'dangling_reference')).toBe(true);
  });
  it('inheritRelations lists, per child type, the reference property and the parent type', () => {
    const f = withChild({});
    const map = inheritRelations(f.types ?? {});
    expect(map.get('massnahme')).toEqual([{ property: 'baum', parentType: 'baum' }]);
    expect(map.get('baum')).toBeUndefined();
  });
});
