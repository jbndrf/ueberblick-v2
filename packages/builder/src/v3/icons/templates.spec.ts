import { describe, expect, it } from 'vitest';
import { checkMarkerSvg, MARKER_ICONS } from '@ueberblick/core';
import { ICON_BADGES, ICON_TEMPLATES, templateIcon, templateSvg } from './templates';

const first = ICON_TEMPLATES[0];
if (first === undefined) throw new Error('no templates');

describe('icon templates', () => {
  it("offers v3's nine templates and six badges", () => {
    expect(ICON_TEMPLATES.map((t) => t.id)).toEqual([
      'circle',
      'square',
      'triangle',
      'diamond',
      'hexagon',
      'pentagon',
      'pin',
      'flag',
      'cross',
    ]);
    expect(ICON_BADGES).toHaveLength(6);
  });

  it('maps pin and flag to registry keys that exist', () => {
    const mapped = ICON_TEMPLATES.filter((t) => t.registryKey !== undefined);
    expect(mapped.map((t) => t.id)).toEqual(['pin', 'flag']);
    for (const t of mapped) expect(MARKER_ICONS.keys).toContain(t.registryKey);
  });

  it('every template, with and without every badge, passes the one SVG gate', () => {
    for (const template of ICON_TEMPLATES)
      for (const badge of [undefined, ...ICON_BADGES])
        expect(
          checkMarkerSvg(templateSvg({ template, color: '#112233', size: 40, badge })),
          template.id,
        ).toEqual([]);
  });

  it('bakes the colour in and sizes the badge as v3 did (40 percent, top right)', () => {
    const svg = templateSvg({ template: first, color: '#112233', size: 50, badge: ICON_BADGES[0] });
    expect(svg).toContain('fill="#112233"');
    expect(svg).not.toContain('currentColor');
    expect(svg).toContain('x="30" y="0" width="20" height="20"');
  });

  it('writes { key } for a mapped template without a badge, { svg } otherwise; the size only when not the default', () => {
    const pin = ICON_TEMPLATES.find((t) => t.id === 'pin');
    if (pin === undefined) throw new Error('no pin');
    expect(templateIcon({ template: pin, color: '#112233' })).toEqual({ key: 'map-pin' });
    expect(templateIcon({ template: pin, color: '#112233', size: 48 })).toEqual({ key: 'map-pin', size: 48 });
    expect(templateIcon({ template: pin, color: '#112233', badge: ICON_BADGES[0] })).toHaveProperty('svg');
    expect(templateIcon({ template: first, color: '#112233', size: 32 })).toHaveProperty('svg');
    expect(templateIcon({ template: first, color: '#112233', size: 32 })).not.toHaveProperty('size');
  });
});
