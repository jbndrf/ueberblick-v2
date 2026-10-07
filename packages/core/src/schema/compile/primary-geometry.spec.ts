import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compile } from './index';
import { TemplateFileSchema, type TemplateFile } from '../file';
import { goldenAssets } from '../../testing/golden';

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const base = (): TemplateFile => TemplateFileSchema.parse(parse(Object.values(raw)[0] as string));

/** B-009: the declared `types.<t>.geometry` is `FoldType.primaryGeometry`; the fold type lists all geometry properties. */
describe('compile: FoldType.primaryGeometry', () => {
  it('is the declared geometry key, and geometryProperties stays the union', () => {
    const f = base();
    const entry = Object.entries(f.types ?? {}).find(([, x]) => x.geometry !== undefined);
    if (entry === undefined) throw new Error('fixture needs a type with a geometry');
    const [key, t] = entry;
    t.properties['zweite'] = { type: 'geometry' } as never;
    const r = compile(f, { assets: goldenAssets });
    if (!r.ok) throw new Error('expected ok');
    const ft = r.config.foldTypes.get(key as never);
    expect(ft?.primaryGeometry).toBe(t.geometry);
    expect(ft?.geometryProperties).toContain('zweite');
    expect(ft?.geometryProperties).toContain(t.geometry);
  });

  it('is absent when the type declares no geometry, even with geometry properties', () => {
    const f = base();
    const entry = Object.entries(f.types ?? {}).find(([, x]) => x.geometry !== undefined);
    if (entry === undefined) throw new Error('fixture needs a type with a geometry');
    delete entry[1].geometry;
    const r = compile(f, { assets: goldenAssets });
    if (!r.ok) throw new Error('expected ok');
    const ft = r.config.foldTypes.get(entry[0] as never);
    expect(ft?.geometryProperties.length).toBeGreaterThan(0);
    expect(ft?.primaryGeometry).toBeUndefined();
  });
});
