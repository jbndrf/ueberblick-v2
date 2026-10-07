// WP-341: the automatic value mappings of a preview refresh (A-031 item 2).
import { describe, expect, it } from 'vitest';
import { diff, type TemplateFile } from '@ueberblick/core';
import { previewMappings } from './mappings';

interface Doc {
  types: {
    baum: {
      process?: { property: string; start: string; end: string[] };
      properties: Record<string, unknown>;
    };
  };
}

function file(
  opts: Record<string, string>,
  extra: Record<string, unknown> = {},
  art: Record<string, string> = { a: 'A', b: 'B', c: 'C' },
  start = 'neu',
): TemplateFile {
  const doc: Doc & Record<string, unknown> = {
    schema: 'ueberblick/1',
    template: { key: 'm', version: '1.0.0' },
    types: {
      baum: {
        label: 'Baum',
        process: { property: 'stage', start, end: ['fertig'] },
        properties: {
          stage: { type: 'select', options: opts },
          art: { type: 'select', options: art },
          ...extra,
        },
      },
    },
  } as never;
  return doc as unknown as TemplateFile;
}

const FULL = { neu: 'Neu', mitte: 'Mitte', fertig: 'Fertig' };
const map = (before: TemplateFile, after: TemplateFile) => previewMappings(diff(before, after), after);

describe('previewMappings', () => {
  it('a removed stage option moves to the process start', () => {
    expect(map(file(FULL), file({ neu: 'Neu', fertig: 'Fertig' }))).toEqual({
      'types.baum.properties.stage.options.mitte': { to: 'neu' },
    });
  });

  it('a removed process start moves to the new process start (never to itself)', () => {
    expect(
      map(file(FULL), file({ eins: 'Eins', mitte: 'Mitte', fertig: 'Fertig' }, {}, undefined, 'eins')),
    ).toMatchObject({ 'types.baum.properties.stage.options.neu': { to: 'eins' } });
  });

  it('a removed option of an ordinary property moves to the first remaining option', () => {
    expect(map(file(FULL), file(FULL, {}, { b: 'B', c: 'C' }))).toEqual({
      'types.baum.properties.art.options.a': { to: 'b' },
    });
  });

  it('a removed property is discarded', () => {
    expect(map(file(FULL, { notiz: { type: 'text' } }), file(FULL))).toEqual({
      'types.baum.properties.notiz': { discard: true },
    });
  });

  it('a property whose options are all gone is discarded option by option', () => {
    expect(map(file(FULL), file(FULL, {}, { z: 'Z' }))).toEqual({
      'types.baum.properties.art.options.a': { to: 'z' },
      'types.baum.properties.art.options.b': { to: 'z' },
      'types.baum.properties.art.options.c': { to: 'z' },
    });
  });

  it('nothing breaking, nothing mapped', () => {
    expect(map(file(FULL), file({ ...FULL, extra: 'Extra' }))).toEqual({});
  });

  it('every removal of one option maps into the remaining options (property)', () => {
    const keys = ['a', 'b', 'c', 'd'];
    for (const gone of keys) {
      const all = Object.fromEntries(keys.map((k) => [k, k]));
      const rest = Object.fromEntries(keys.filter((k) => k !== gone).map((k) => [k, k]));
      const m = map(file(FULL, {}, all), file(FULL, {}, rest));
      const to = (m[`types.baum.properties.art.options.${gone}`] as { to: string }).to;
      expect(Object.keys(rest)).toContain(to);
    }
  });
});
