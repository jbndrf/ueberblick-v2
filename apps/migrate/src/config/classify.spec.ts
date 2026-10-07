/** WP-357 acceptance: v3 icon_config, marker_color, filter_value_icons and the filterable tag become marker and classify. */
import { readFileSync } from 'node:fs';
import { compile, merge, NO_ASSETS } from '@ueberblick/core';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { convertConfig } from './convert';

const load = (url: string): unknown => parse(readFileSync(new URL(url, import.meta.url), 'utf8')) as unknown;
const v3 = load('../../../../fixtures/legacy/icons-classify.yaml');
const result = convertConfig(v3);
const types = result.template.types ?? {};
const item = (id: string) => result.report.items.find((i) => i.id === id);

describe('stage mode (baum)', () => {
  it('migrates icon_config, marker_color and the per-stage icons to the exact YAML', () => {
    const { marker, classify } = types['baum'] ?? {};
    const golden = readFileSync(
      new URL('../../../../fixtures/golden/migrate/icons-classify.types.yaml', import.meta.url),
      'utf8',
    );
    expect(
      stringify({
        baum: { marker, classify },
        leitung: pick('leitung'),
        flaeche: pick('flaeche'),
        rohr: pick('rohr'),
      }),
    ).toBe(golden);
  });

  it('compiles with no problems', () => {
    const merged = merge(result.template, result.overlay);
    expect(merged.issues).toEqual([]);
    const compiled = compile(merged.file, { assets: NO_ASSETS });
    expect(compiled.ok ? [] : compiled.problems).toEqual([]);
    expect(result.check.problems).toEqual([]);
  });

  it('carries the icon colour over marker_color and reports the dropped value icons', () => {
    expect(types['baum']?.marker?.color).toBe('#16a34a');
    expect(item('workflows.baum.marker_color')?.status).toBe('approximated');
    const fv = item('workflows.baum.filter_value_icons');
    expect(fv?.status).toBe('approximated');
    expect(fv?.reason).toMatch(/"erledigt": no svgContent/);
    expect(fv?.reason).toMatch(/classify_value_unknown: "geloescht"/);
  });

  it('reports non-default style fields once per icon, with the field names', () => {
    const reason = item('workflows.baum.icon_config')?.reason ?? '';
    expect(reason).toBe('icon_config: style.shape, style.borderWidth, style.borderColor not carried (B-018)');
    const fv = item('workflows.baum.filter_value_icons')?.reason ?? '';
    expect(fv.match(/style\.shadow/g)?.length).toBe(1);
  });
});

function pick(k: string) {
  const { marker, classify } = types[k] ?? {};
  return { marker, classify };
}

describe('field mode (leitung)', () => {
  it('maps option labels to option keys, uses the last tag, and reports a deleted option', () => {
    const c = types['leitung']?.classify;
    expect(c?.property).toBe('zustand');
    expect(Object.keys(c?.values ?? {})).toEqual(['gut']);
    expect(item('workflows.leitung.filter_value_icons')?.reason).toMatch(/classify_value_unknown: "Alt"/);
    expect(item('workflows.leitung.field_tags.0.0')?.reason).toMatch(/last filterable tag/);
    expect(item('workflows.leitung.field_tags.0.1')?.status).toBe('approximated');
  });
});

describe('multiselect tag (flaeche)', () => {
  it('gives no classify and says so; the value icons are dropped with a reason', () => {
    expect(types['flaeche']?.classify).toBeUndefined();
    expect(types['flaeche']?.marker).toEqual({ color: '#2e7d32' });
    expect(item('workflows.flaeche.field_tags.0.0')?.reason).toMatch(
      /classify_property_invalid: a multiselect/,
    );
    expect(item('workflows.flaeche.filter_value_icons')?.status).toBe('dropped');
  });
});

describe('an SVG that fails the check (rohr)', () => {
  it('is reported with marker_icon_invalid and never written; the colour survives', () => {
    const m = types['rohr']?.marker;
    expect(m).toEqual({ color: '#123456' });
    const r = item('workflows.rohr.icon_config');
    expect(r?.status).toBe('approximated');
    expect(r?.reason).toMatch(/marker_icon_invalid/);
    expect(r?.reason).toMatch(/clamped to 128/);
    expect(item('workflows.rohr.marker_color')?.status).toBe('approximated');
  });
});
