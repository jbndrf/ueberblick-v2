// WP-043: compile rejects derive expressions fold cannot compute.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import raw from '/fixtures/golden/templates/veranstaltung/1.0.0.yaml?raw';
import { TemplateFileSchema } from '../file';
import { compile as compileWith } from './index';
import { goldenAssets } from '../../testing/golden';
/** Compiles with the golden bundle, so `$ref` layer styles resolve (WP-577). */
const compile = (f: Parameters<typeof compileWith>[0]) => compileWith(f, { assets: goldenAssets });

type Src = { types: Record<string, { relations: Record<string, { derive: string }> }> };

function codesFor(derive: string): string[] {
  const src = parse(raw) as Src;
  const rel = src.types['veranstaltung']?.relations['kollision'];
  if (!rel) throw new Error('fixture changed');
  rel.derive = derive;
  const r = compile(TemplateFileSchema.parse(src));
  return r.ok ? [] : r.problems.map((p) => p.code);
}

describe('compile: derive shape', () => {
  it('accepts a conjunction with the spatial predicate as an operand', () => {
    expect(
      codesFor('intersects(self.geometrie, other.geometrie) && self != other && self.datum == other.datum'),
    ).toEqual([]);
  });
  it('rejects a spatial predicate under ||', () => {
    expect(codesFor('self.datum == other.datum || intersects(self.geometrie, other.geometrie)')).toEqual([
      'derive_no_prefilter',
    ]);
  });
  it('rejects a spatial predicate under !', () => {
    expect(codesFor('!intersects(self.geometrie, other.geometrie)')).toEqual(['derive_no_prefilter']);
  });
  it('rejects a derive without a spatial predicate', () => {
    expect(codesFor('self.datum == other.datum')).toEqual(['derive_no_prefilter']);
  });
  it('rejects reading through a relation, but not own properties', () => {
    const p = 'intersects(self.geometrie, other.geometrie) && ';
    expect(codesFor(p + 'other.auflagen.size() > 0')).toEqual(['derive_traverses_relation']);
    expect(codesFor(p + 'self.auflagen.all(a, a.erfuellt)')).toEqual(['derive_traverses_relation']);
    expect(codesFor(p + 'other.auflagen.exists(a, a.erfuellt)')).toEqual(['derive_traverses_relation']);
    expect(codesFor(p + 'self.datum == other.datum')).toEqual([]);
  });
  it('rejects now and today()', () => {
    expect(codesFor('intersects(self.geometrie, other.geometrie) && other.datum > today()')).toEqual([
      'derive_uses_time',
    ]);
    expect(codesFor('intersects(self.geometrie, other.geometrie) && now != null')).toEqual([
      'derive_uses_time',
    ]);
  });
});
