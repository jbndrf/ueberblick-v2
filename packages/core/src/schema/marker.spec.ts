// WP-674 (B-018): the classifying property and the marker of a feature type: schema, SVG check, compile, resolution chain.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from 'yaml';
import { DEFAULT_MARKER_COLOR, MARKER_ICON_SIZE, MARKER_ICONS } from '../registry';
import { goldenAssets } from '../testing/golden';
import { compile, NO_ASSETS } from './compile';
import { TemplateFileSchema, type TemplateFile } from './file';
import { ClassifySchema, MarkerAppearanceSchema } from './marker';
import { checkMarkerSvg, resolveMarker } from '../marker';

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24z"/><circle cx="1" cy="1" r="1"/></svg>';
const okClassify = (c: unknown): boolean => ClassifySchema.safeParse(c).success;
const okLook = (c: unknown): boolean => MarkerAppearanceSchema.safeParse(c).success;

describe('marker and classify schema', () => {
  it('accepts a colour and each of the three icon forms, with an optional size', () => {
    expect(okLook({ color: '#16a34a' })).toBe(true);
    expect(okLook({ icon: { key: 'leaf' } })).toBe(true);
    expect(okLook({ icon: { svg: SVG, size: 40 } })).toBe(true);
    expect(okLook({ color: '#aabbcc', icon: { $ref: 'icons/x.svg', size: MARKER_ICON_SIZE.max } })).toBe(
      true,
    );
    expect(okClassify({ property: 'stage', values: { erfasst: { color: '#16a34a' } } })).toBe(true);
  });
  it('rejects unknown values, keys, colours and sizes', () => {
    expect(okLook({ icon: { key: 'unicorn' } })).toBe(false);
    expect(okLook({ icon: { key: 'leaf', extra: 1 } })).toBe(false);
    expect(okLook({ icon: { key: 'leaf', svg: SVG } })).toBe(false);
    expect(okLook({ color: 'red' })).toBe(false);
    expect(okLook({ color: '#fff' })).toBe(false);
    expect(okLook({ icon: { key: 'leaf', size: MARKER_ICON_SIZE.min - 1 } })).toBe(false);
    expect(okLook({ icon: { key: 'leaf', size: MARKER_ICON_SIZE.max + 1 } })).toBe(false);
    expect(okLook({ icon: { key: 'leaf', size: 12.5 } })).toBe(false);
    expect(okLook({ shape: 'pin' })).toBe(false);
    expect(okClassify({ property: 'stage' })).toBe(false);
    expect(okClassify({ property: 'stage', values: { Bad: {} } })).toBe(false);
  });
});

describe('checkMarkerSvg', () => {
  it('accepts a plain svg', () => expect(checkMarkerSvg(SVG)).toEqual([]));
  it.each([
    ['not an svg', '<div/>'],
    ['a script element', '<svg><script>x</script></svg>'],
    ['an event attribute', '<svg><path onload="x()" d="M0 0"/></svg>'],
    ['an external href', '<svg><use href="https://x.example/a.svg#b"/></svg>'],
    ['a javascript url', '<svg><a fill="javascript:x"/></svg>'],
    ['a doctype', '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>'],
    ['an image element', '<svg><image href="#a"/></svg>'],
    ['a > inside a quoted value', '<svg><path d=">" onclick="x()"/></svg>'],
    ['an unquoted on* value', '<svg><path onclick=alert(1) d="M0 0"/></svg>'],
    ['both combined', '<svg><path title=">" onclick=alert(1)/></svg>'],
    ['an entity in an attribute name', '<svg><path &#111;nclick="x()"/></svg>'],
    ['a slash before the attribute', '<svg><path/onclick="x()"/></svg>'],
    ['a foreignObject', '<svg><foreignObject/></svg>'],
    ['a style element', '<svg><style>a{}</style></svg>'],
    ['a use element', '<svg><use href="#a"/></svg>'],
    ['an animate with onbegin', '<svg><animate onbegin="x()"/></svg>'],
    ['an unquoted external href', '<svg><path href=http://x.example/a/></svg>'],
    ['an unclosed quote', '<svg><path d="M0 0/></svg>'],
    ['too large', `<svg><path d="${'M0 0'.repeat(20000)}"/></svg>`],
  ])('rejects %s', (_name, svg) => expect(checkMarkerSvg(svg).length).toBeGreaterThan(0));
  it('accepts a comment and an unquoted harmless value', () =>
    expect(checkMarkerSvg('<svg><!-- a > b --><path d=M0 stroke-width=2 /></svg>')).toEqual([]));
  it('refuses any on* attribute in any quoting or position', () =>
    fc.assert(
      fc.property(
        fc.constantFrom('', ' ', '\n', '\t'),
        fc.constantFrom('', 'x'),
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.constantFrom('"', "'", ''),
        fc.constantFrom('', '>', 'a>b', "a'b", 'x y'),
        fc.constantFrom('on', 'ON', 'On'),
        fc.boolean(),
        (ws, pre, rest, quote, val, on, before) => {
          const safe = quote === '' ? val.replace(/[\s>'"]/g, '') || 'v' : val;
          if (quote === "'" && safe.includes("'")) return;
          const attr = `${on}${rest}=${quote}${safe}${quote}`;
          const other = `${pre === '' ? 'd' : 'title'}="${pre === '' ? 'M0' : '>'}"`;
          const tag = before ? `<path${ws || ' '}${attr} ${other}/>` : `<path ${other}${ws || ' '}${attr}/>`;
          expect(checkMarkerSvg(`<svg>${tag}</svg>`).length).toBeGreaterThan(0);
        },
      ),
    ));
  it('accepts an internal href', () =>
    expect(checkMarkerSvg('<svg><defs/><path d="M0 0"/></svg>')).toEqual([]));
});

const base = (): Record<string, unknown> =>
  parse(`
schema: ueberblick/1
template: { key: t, version: 1.0.0 }
roles: { r: { label: R, app: { home: karte, views: { karte: {} } } } }
types:
  baum:
    label: Baum
    geometry: standort
    properties:
      standort: { type: geometry, geometry_type: point }
      stage: { type: select, options: { a: A, b: B } }
      vitalitaet: { type: select, options: { v0: '0', v1: '1' } }
      art: { type: multiselect, options: { x: X } }
      befund: { type: text }
    classify:
      property: vitalitaet
      values:
        v0: { color: '#16a34a', icon: { key: leaf } }
        v1: { icon: { $ref: icons/mangel.svg, size: 40 } }
    marker: { color: '#336699', icon: { key: map-pin } }
views: { karte: { source: { type: baum } } }
`) as Record<string, unknown>;
const file = (f: Record<string, unknown>): TemplateFile => TemplateFileSchema.parse(f);
const withClassify = (c: unknown): TemplateFile => {
  const f = base();
  (f.types as { baum: { classify: unknown } }).baum.classify = c;
  return file(f);
};

describe('compile of classify and marker', () => {
  it('embeds a $ref icon as an inline svg and keeps the size', () => {
    const r = compile(file(base()), { assets: (ref) => (ref === 'icons/mangel.svg' ? SVG : undefined) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.file.types?.baum?.classify?.values.v1?.icon).toEqual({ svg: SVG, size: 40 });
    expect(JSON.stringify(r.config.file)).not.toContain('$ref');
  });
  it('refuses a $ref the bundle does not hold, and any $ref of a self-contained file', () => {
    const missing = compile(file(base()), { assets: goldenAssets });
    const none = compile(file(base()), { assets: NO_ASSETS });
    for (const r of [missing, none]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems.map((p) => p.code)).toContain('asset_unresolved');
    }
  });
  it('refuses an unsafe resolved svg', () => {
    const r = compile(file(base()), { assets: () => '<svg><script>x</script></svg>' });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.problems.find((p) => p.code === 'marker_icon_invalid')?.path).toContain(
        'classify.values.v1.icon.svg',
      );
  });
  it('accepts the stage property and refuses a multiselect, a text property and unknown option keys', () => {
    const svgOnly = { assets: () => SVG };
    expect(
      compile(withClassify({ property: 'stage', values: { a: { color: '#112233' } } }), svgOnly).ok,
    ).toBe(true);
    for (const c of [
      { property: 'art', values: {} },
      { property: 'befund', values: {} },
      { property: 'nix', values: {} },
    ]) {
      const r = compile(withClassify(c), svgOnly);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems.map((p) => p.code)).toContain('classify_property_invalid');
    }
    const r = compile(withClassify({ property: 'stage', values: { zz: {} } }), svgOnly);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.code)).toContain('classify_value_unknown');
  });
});

describe('resolveMarker (the v3 fallback chain)', () => {
  it('uses the value look, then the type marker, then the default dot', () => {
    const type = {
      classify: { property: 'p', values: { a: { color: '#111111', icon: { key: 'leaf', size: 20 } } } },
      marker: { color: '#222222', icon: { key: 'map-pin' } },
    } as const;
    expect(resolveMarker(type, 'a')).toEqual({ color: '#111111', icon: { key: 'leaf' }, size: 20 });
    expect(resolveMarker(type, 'other')).toEqual({ color: '#222222', icon: { key: 'map-pin' }, size: 32 });
    expect(resolveMarker({}, 'a')).toEqual({ color: DEFAULT_MARKER_COLOR, size: 32 });
  });
  const look = fc.record(
    {
      color: fc.constantFrom('#111111', '#222222', '#333333'),
      icon: fc.oneof(
        fc.record({ key: fc.constantFrom(...MARKER_ICONS.keys) }),
        fc.record({ svg: fc.constant(SVG), size: fc.integer({ min: 8, max: 128 }) }),
      ),
    },
    { requiredKeys: [] },
  );
  it('property: colour and icon each come from the first of value, marker that has one', () => {
    fc.assert(
      fc.property(look, look, fc.constantFrom('a', 'b', undefined, 3), (value, marker, v) => {
        const type = { classify: { property: 'p', values: { a: value } }, marker };
        const got = resolveMarker(type as never, v);
        const own = v === 'a' ? value : undefined;
        expect(got.color).toBe(own?.color ?? marker.color ?? DEFAULT_MARKER_COLOR);
        const icon = own?.icon ?? marker.icon;
        if (icon === undefined) expect(got.icon).toBeUndefined();
        else {
          expect(got.icon).toEqual('key' in icon ? { key: icon.key } : { svg: icon.svg });
          expect(got.size).toBe(('size' in icon && icon.size) || MARKER_ICON_SIZE.default);
        }
      }),
    );
  });
});
