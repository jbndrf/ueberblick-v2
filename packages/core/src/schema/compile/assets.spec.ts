// WP-577: compile resolves `$ref` layer styles from the bundle and validates tool settings.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { TemplateFileSchema, type TemplateFile } from '../file';
import { merge } from '../../template';
import { OverlayFileSchema } from '../file';
import type { AssetResolver } from './assets';
import { compile, hydrate, NO_ASSETS, serialize } from './index';
import { goldenAssets } from '../../testing/golden';

const templates = import.meta.glob('/fixtures/golden/templates/*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const candidates = import.meta.glob('/fixtures/golden/candidates/*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const projects = import.meta.glob('/fixtures/golden/projects/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The golden bundle: `styles/<name>.json` and `icons/<name>.svg` as a `$ref` names them. */
const bundle: AssetResolver = goldenAssets;

const file = (yaml: string): TemplateFile => TemplateFileSchema.parse(parse(yaml));
const goldenTemplates = Object.entries(templates).map(([f, s]) => [f, file(s as string)] as const);

const REF_FREE = (v: unknown): boolean => JSON.stringify(v).includes('"$ref"') === false;

function layerStyles(f: TemplateFile): unknown[] {
  return Object.values(f.views ?? {}).flatMap((v) => Object.values(v.layers ?? {}).map((l) => l.style));
}

describe('golden templates: every view style resolves', () => {
  it('finds templates with $ref styles', () => {
    // WP-759: no golden template styles a view layer any more (looks are the only feature style, B-024); the
    // candidate keeps one $ref so the asset pipeline still has a real file to resolve
    const withRef = Object.values(candidates).filter((s) =>
      layerStyles(file(s as string)).some((x) => x !== undefined),
    );
    expect(withRef.length).toBeGreaterThanOrEqual(1);
  });
  for (const [name, t] of goldenTemplates) {
    it(`${name}: compiled config holds the style JSON and no $ref`, () => {
      const r = compile(t, { assets: bundle });
      if (!r.ok) throw new Error(JSON.stringify(r.problems));
      expect(REF_FREE(r.config.file.views)).toBe(true);
      const before = layerStyles(t).filter((s) => s !== undefined);
      const after = layerStyles(r.config.file).filter((s) => s !== undefined);
      expect(after).toHaveLength(before.length);
      for (const s of after) expect(Array.isArray((s as { layers: unknown }).layers)).toBe(true);
    });
  }
  it('golden projects (overlay merged) resolve too', () => {
    for (const [, src] of Object.entries(projects)) {
      const o = OverlayFileSchema.parse(parse(src as string));
      const [key, major] = o.extends.split('@');
      const base = goldenTemplates
        .filter(([f, t]) => f.includes(`/${key}/`) && t.template.version.startsWith(`${major}.`))
        .map(([, t]) => t)
        .pop();
      if (base === undefined || o.extends === 'x') continue;
      const m = merge(base, o);
      if (m.issues.length > 0) continue; // the negative overlay
      const r = compile(TemplateFileSchema.parse(m.file), { assets: bundle });
      if (!r.ok) throw new Error(JSON.stringify(r.problems));
      expect(REF_FREE(r.config.file.views)).toBe(true);
    }
  });
});

const base = (): TemplateFile => {
  const t = goldenTemplates.find(([f]) => f.includes('baumkataster/2.0.0'));
  if (t === undefined) throw new Error('golden template missing');
  const f = structuredClone(t[1]) as unknown as {
    views: Record<string, { layers: Record<string, unknown> }>;
  };
  // the golden template carries no layer style since WP-759: give the first layer the $ref these specs resolve
  f.views.karte = {
    ...f.views.karte,
    layers: {
      flaechen: {
        source: { type: 'flaeche' },
        renderer: 'maplibre-2d',
        style: { $ref: 'styles/flaeche.json' },
      },
    },
  };
  return TemplateFileSchema.parse(f);
};

const withStyle = (style: unknown, renderer = 'maplibre-2d'): TemplateFile => {
  const f = base() as unknown as { views: Record<string, { layers: Record<string, unknown> }> };
  (f.views.karte as { layers: unknown }).layers = { l: { renderer, style } };
  return TemplateFileSchema.parse(f);
};

describe('an unresolvable $ref or a bad style is a compile error with its path', () => {
  it('missing bundle file names the layer path', () => {
    const r = compile(withStyle({ $ref: 'styles/nope.json' }), { assets: bundle });
    expect(r.ok).toBe(false);
    const p = r.ok ? [] : r.problems.filter((x) => x.code === 'asset_unresolved');
    expect(p.map((x) => x.path)).toEqual(['views.karte.layers.l.style']);
    expect(p[0]?.message).toContain('styles/nope.json');
    expect(p[0]?.hint?.length).toBeGreaterThan(0);
  });
  it('NO_ASSETS refuses any $ref (a self-contained file, B-013)', () => {
    const r = compile(withStyle({ $ref: 'styles/baum.json' }), { assets: NO_ASSETS });
    expect(r.ok ? [] : r.problems.map((x) => x.code)).toContain('asset_unresolved');
  });
  it.each([
    ['not an object', []],
    ['layers is not a list', { layers: 3 }],
    ['a layer without an id', { layers: [{ type: 'circle' }] }],
  ])('bad shape: %s', (_n, json) => {
    const r = compile(withStyle({ $ref: 'styles/x.json' }), { assets: () => json });
    const p = r.ok ? [] : r.problems.filter((x) => x.code === 'style_invalid');
    expect(p.map((x) => x.path)).toEqual(['views.karte.layers.l.style']);
  });
  it('an inline style is shape-checked too', () => {
    const r = compile(withStyle({ layers: [{}] }), { assets: goldenAssets });
    expect(r.ok ? [] : r.problems.map((x) => x.code)).toContain('style_invalid');
  });
  it('an inline good style passes and is untouched', () => {
    const style = { layers: [{ id: 'a', type: 'circle', source: 'ub-clusters' }] };
    const r = compile(withStyle(style), { assets: goldenAssets });
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.config.file.views?.karte?.layers?.l?.style).toEqual(style);
  });
  it('property: any compile that succeeds has no $ref left', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('styles/baum.json', 'styles/flaeche.json', 'styles/zzz.json'), {
          minLength: 1,
          maxLength: 4,
        }),
        (refs) => {
          const f = base() as unknown as { views: Record<string, { layers: Record<string, unknown> }> };
          (f.views.karte as { layers: unknown }).layers = Object.fromEntries(
            refs.map((r, i) => [`l${i}`, { renderer: 'maplibre-2d', style: { $ref: r } }]),
          );
          const r = compile(TemplateFileSchema.parse(f), { assets: bundle });
          expect(r.ok).toBe(!refs.includes('styles/zzz.json'));
          if (r.ok) expect(REF_FREE(r.config.file.views)).toBe(true);
        },
      ),
    );
  });
});

describe('serialize and hydrate round-trip the embedded styles', () => {
  it('the embedded style survives JSON, the hash covers it', () => {
    const t = base();
    const r = compile(t, { assets: bundle });
    if (!r.ok) throw new Error('expected ok');
    const data = JSON.parse(JSON.stringify(serialize(r.config)));
    const h = hydrate(data);
    expect(h.file).toEqual(r.config.file);
    expect(REF_FREE(h.file.views)).toBe(true);
    const changed: AssetResolver = (ref) => {
      const s = bundle(ref) as { layers: { id: string }[] };
      return { layers: s.layers.map((l) => ({ ...l, id: `${l.id}2` })) };
    };
    const r2 = compile(t, { assets: changed });
    if (!r2.ok) throw new Error('expected ok');
    expect(r2.config.hash).not.toBe(r.config.hash);
  });
});

describe('tools.search.sources', () => {
  const withSources = (sources: unknown): TemplateFile => {
    const f = base() as unknown as { tools: Record<string, unknown> };
    f.tools.search = { sources };
    return TemplateFileSchema.parse(f);
  };
  const codes = (r: ReturnType<typeof compile>) =>
    r.ok ? [] : r.problems.filter((p) => p.code === 'tool_source_invalid');
  it('accepts a searchable property', () => {
    expect(codes(compile(withSources(['baum.befund']), { assets: bundle }))).toEqual([]);
  });
  it.each([
    ['no dot', 'address', 'tools.search.sources["0"]'],
    ['unknown type', 'nix.name', 'tools.search.sources["0"]'],
    ['unknown property', 'baum.nix', 'tools.search.sources["0"]'],
    ['a geometry property', 'baum.geometrie', 'tools.search.sources["0"]'],
    ['a localized text property', 'baum.beschreibung', 'tools.search.sources["0"]'],
  ])('rejects %s', (_n, entry, path) => {
    const p = codes(compile(withSources([entry]), { assets: bundle }));
    expect(p.map((x) => x.path)).toEqual([path]);
    expect(p[0]?.hint?.length).toBeGreaterThan(0);
  });
  it('rejects a non-list', () => {
    expect(codes(compile(withSources('baum.befund'), { assets: bundle })).map((x) => x.path)).toEqual([
      'tools.search.sources',
    ]);
  });
});
