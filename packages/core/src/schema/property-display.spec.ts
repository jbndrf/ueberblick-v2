// WP-659: `properties.<p>.display` (tab, tab_order, order, hidden, condition, history). Schema, compile, overlay.
import { describe, expect, it } from 'vitest';
import { merge } from '../template';
import { OverlayFileSchema, TemplateFileSchema } from './file';
import { PropertyDisplaySchema } from './property-display';
import { PROPERTY_DISPLAY_COLUMNS, PROPERTY_HISTORY_HINTS } from '../registry';
import { compile } from './compile';
import { goldenAssets } from '../testing/golden';
import { computedFile } from './compile/__fixtures__/computed';

type F = ReturnType<typeof computedFile>;
const parcel = (f: F) => f.types['parcel'] as F['types'][string];
const run = (display: unknown) => {
  const f = computedFile();
  (parcel(f).properties['area'] as unknown as Record<string, unknown>)['display'] = display;
  return compile(TemplateFileSchema.parse(f), { assets: goldenAssets });
};

describe('PropertyDisplaySchema', () => {
  it('accepts every field', () => {
    const r = PropertyDisplaySchema.safeParse({
      tab: { de: 'Kontrolle', en: 'Inspection' },
      tab_order: 2,
      row: 1,
      column: 'left',
      hidden: false,
      condition: 'self.area > 0',
      history: 'measurements',
    });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown key and a hint that is not in the registry', () => {
    expect(PropertyDisplaySchema.safeParse({ colour: 1 }).success).toBe(false);
    expect(PropertyDisplaySchema.safeParse({ history: 'readings' }).success).toBe(false);
    expect(PropertyDisplaySchema.safeParse({ column: 'middle' }).success).toBe(false);
  });
  it('the hints are the registry keys', () => {
    expect([...PROPERTY_HISTORY_HINTS.keys].sort()).toEqual(['changes', 'measurements']);
    expect([...PROPERTY_DISPLAY_COLUMNS.keys].sort()).toEqual(['full', 'left', 'right']);
  });
});

describe('compile: display.condition', () => {
  it('a CEL condition compiles and its checked expression is kept by path', () => {
    const r = run({ condition: 'self.width > 3' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.expressions.has('types.parcel.properties.area.display.condition')).toBe(true);
  });
  it('a condition that is not a bool is a problem at the condition path', () => {
    const r = run({ condition: 'self.width + 1' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems.map((p) => p.code)).toContain('expression_type');
      expect(r.problems[0]?.path).toBe('types.parcel.properties.area.display.condition');
    }
  });
  it('a condition that reads a property that does not exist is a problem', () => {
    const r = run({ condition: 'self.nope == 1' });
    expect(r.ok).toBe(false);
  });
});

describe('golden: baumkataster 2.0.0 lays out Daten', () => {
  const raw = import.meta.glob('/fixtures/golden/templates/baumkataster/2.0.0.yaml', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  it('compiles with the display settings and keeps the condition', async () => {
    const { parse } = await import('yaml');
    const file = TemplateFileSchema.parse(parse(Object.values(raw)[0] as string));
    const r = compile(file, { assets: goldenAssets });
    expect(r.ok).toBe(true);
    const props = file.types?.['baum']?.properties;
    expect(props?.['vitalitaet']?.display).toMatchObject({
      tab: 'Kontrolle',
      column: 'left',
      history: 'measurements',
    });
    if (r.ok) expect(r.config.expressions.has('types.baum.properties.befund.display.condition')).toBe(true);
  });
});

describe('overlay: display is set and overridden by key path', () => {
  const base = TemplateFileSchema.parse(computedFile());
  const overlay = (override: Record<string, unknown>, add: Record<string, unknown> = {}) =>
    OverlayFileSchema.parse({ schema: 'ueberblick/1', extends: 'x@1', override, add });
  it('sets display on a property that has none', () => {
    const r = merge(base, overlay({}, { 'types.parcel.properties.area.display': { tab: 'Kontrolle' } }));
    expect(r.issues).toEqual([]);
    expect(r.file.types?.['parcel']?.properties['area']?.display).toEqual({ tab: 'Kontrolle' });
  });
  it('adds one field to an existing display and overrides another', () => {
    const first = merge(base, overlay({}, { 'types.parcel.properties.area.display': { tab: 'A', row: 1 } }));
    const second = merge(
      TemplateFileSchema.parse(first.file),
      overlay(
        { 'types.parcel.properties.area.display.tab': 'B' },
        { 'types.parcel.properties.area.display.hidden': true },
      ),
    );
    expect(second.issues).toEqual([]);
    expect(second.file.types?.['parcel']?.properties['area']?.display).toEqual({
      tab: 'B',
      row: 1,
      hidden: true,
    });
  });
});
