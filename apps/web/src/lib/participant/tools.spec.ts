import { describe, expect, it } from 'vitest';
import type { JsonValue, Key, TemplateFile } from '@ueberblick/core/model';
import { fieldOptions, listNameHeader, taskTypeOf, typeLabelOf, toolLoaderKeys } from './tools';
import { TOOL_MANIFEST } from './tools/manifest';

const file = {
  roles: {
    kontrolle: { label: 'K', app: { tools: { search: { settings: { sources: ['baum.befund'] } } } } },
  },
  types: {
    baum: {
      geometry: 'geometrie',
      properties: { geometrie: { type: 'geometry', geometry_type: 'point' }, foto: { type: 'file' } },
    },
    flaeche: { properties: { geometrie: { type: 'geometry', geometry_type: 'polygon' } } },
  },
  tasks: {
    erfassen: { label: 'E', on: '$map', creates: 'baum' },
    verschieben: { label: 'V', on: 'baum' },
    mehrere: { label: 'M', on: ['flaeche', 'baum'] },
    frei: { label: 'F', on: '$none' },
  },
  tools: { photo: { max_px: 1600 }, draw: {}, search: { sources: ['baum.beschreibung'] } },
} as unknown as TemplateFile;

describe('taskTypeOf', () => {
  it('is the type a task creates, else the type it is offered on, else the first of several', () => {
    expect(taskTypeOf(file, 'erfassen')).toBe('baum');
    expect(taskTypeOf(file, 'verschieben')).toBe('baum');
    expect(taskTypeOf(file, 'mehrere')).toBe('flaeche');
    expect(taskTypeOf(file, 'frei')).toBeUndefined();
    expect(taskTypeOf(file, 'gibt_es_nicht')).toBeUndefined();
  });
});

describe('fieldOptions (WP-551: draw gets geometry_type and center per geometry field)', () => {
  const center = () => [7.1, 50.7] as const;

  it("draw: the field's geometry type and the map centre", () => {
    const options = fieldOptions({ file, roleKey: 'kontrolle', type: 'baum' as Key, center });
    expect(options('draw', 'geometrie')).toEqual({ geometry_type: 'point', center: [7.1, 50.7] });
    const area = fieldOptions({ file, roleKey: 'kontrolle', type: 'flaeche' as Key, center });
    expect(area('draw', 'geometrie')).toMatchObject({ geometry_type: 'polygon' });
  });

  it('draw without a known centre passes none, so a position fix decides', () => {
    const options = fieldOptions({
      file,
      roleKey: 'kontrolle',
      type: 'baum' as Key,
      center: () => undefined,
    });
    expect(options('draw', 'geometrie')).toEqual({ geometry_type: 'point' });
  });

  it("other tools get the project settings of the tool, the role's own settings on top", () => {
    const options = fieldOptions({ file, roleKey: 'kontrolle', type: 'baum' as Key, center });
    expect(options('photo', 'foto')).toEqual({ max_px: 1600 });
    expect(options('search', 'x')).toEqual({ sources: ['baum.befund'] });
    const none: Record<string, JsonValue> = {};
    expect(fieldOptions({ file, roleKey: 'nobody', type: 'baum' as Key, center })('photo', 'foto')).toEqual({
      max_px: 1600,
    });
    expect(none).toEqual({});
  });
});

describe('tool keys', () => {
  it('the app has a loader for photo, draw, measure, search and chat; every tool that mounts has one', () => {
    expect([...toolLoaderKeys()].sort()).toEqual(['chat', 'draw', 'file', 'measure', 'photo', 'search']);
    // A filter-tab-only tool is a tab body the shell draws (`filter-tab` has no tool-host mount yet): no loader.
    const isFilterTabOnly = (c: readonly string[]): boolean => c.length === 1 && c[0] === 'filter-tab';
    const noLoader = TOOL_MANIFEST.filter((t) => !toolLoaderKeys().includes(t.key));
    expect(noLoader.map((t) => t.key).sort()).toEqual(
      TOOL_MANIFEST.filter((t) => isFilterTabOnly(t.contributes))
        .map((t) => t.key)
        .sort(),
    );
    for (const t of TOOL_MANIFEST.filter((x) => !isFilterTabOnly(x.contributes)))
      expect(toolLoaderKeys()).toContain(t.key);
  });
});

const typed = {
  types: { baum: { label: { de: 'Baum', en: 'Tree' } }, ohne: {} },
} as unknown as TemplateFile;

describe('typeLabelOf (WP-600)', () => {
  it('is the localized type label, and the key for a type with no label or no declaration', () => {
    expect(typeLabelOf(typed, 'de')('baum' as Key)).toBe('Baum');
    expect(typeLabelOf(typed, 'en')('baum' as Key)).toBe('Tree');
    expect(typeLabelOf(typed, 'de')('ohne' as Key)).toBe('ohne');
    expect(typeLabelOf(typed, 'de')('fremd' as Key)).toBe('fremd');
  });
});

describe('listNameHeader (WP-600 review 1: the list name column header)', () => {
  it('is the view type label, and the type key when the type has no label; empty without a view', () => {
    expect(listNameHeader(typed, 'de', 'baum' as Key)).toBe('Baum');
    expect(listNameHeader(typed, 'de', 'ohne' as Key)).toBe('ohne');
    expect(listNameHeader(typed, 'de', 'fremd' as Key)).toBe('fremd');
    expect(listNameHeader(typed, 'de', undefined)).toBe('');
  });
});
