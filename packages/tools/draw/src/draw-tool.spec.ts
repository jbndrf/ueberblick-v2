// @vitest-environment jsdom
// WP-635: the draw tool of a form field only says what the drawn value is; drawing is on the map (DrawOnMap).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '@ueberblick/core/model';
import { createToolHost, type ToolField } from '@ueberblick/ui';
import { testPorts } from '@ueberblick/ui/tool-testing';
import { drawTool, summarise } from './draw-tool';

const field: ToolField = { key: 'lage', id: 'f-lage', label: 'Location', type: 'geometry' };
const catalogue = (locale: string) =>
  JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'messages', `${locale}.json`), 'utf8'),
  ) as Record<string, string>;
const ring: JsonValue = [
  [9, 48],
  [9.1, 48],
  [9.1, 48.1],
  [9, 48],
];

async function render(locale: string, value?: JsonValue): Promise<{ text: string; produced: JsonValue[] }> {
  const produced: JsonValue[] = [];
  const host = createToolHost({
    loaders: { draw: async () => drawTool },
    ports: testPorts(),
    locale,
    optionsFor: () => ({}),
  });
  const root = document.createElement('div');
  document.body.append(root);
  await host.mountField(root, {
    toolKey: 'draw',
    field,
    value,
    onproduce: (v) => produced.push(v),
    onclear: () => {},
  });
  return { text: root.textContent ?? '', produced };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('summarise', () => {
  it('counts the parts and positions of every drawn kind, without the closing position of a ring', () => {
    expect(
      summarise({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toEqual({ kind: 'line', parts: 1, points: 2 });
    expect(
      summarise({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
          [
            [2, 2],
            [3, 3],
            [4, 4],
          ],
        ],
      }),
    ).toEqual({
      kind: 'line',
      parts: 2,
      points: 5,
    });
    expect(summarise({ type: 'Polygon', coordinates: [ring] })).toEqual({
      kind: 'area',
      parts: 1,
      points: 3,
    });
    expect(summarise({ type: 'MultiPolygon', coordinates: [[ring], [ring]] })).toEqual({
      kind: 'area',
      parts: 2,
      points: 6,
    });
    expect(summarise({ type: 'Point', coordinates: [1, 1] })).toEqual({ kind: 'point', parts: 1, points: 1 });
  });

  it('is undefined for anything else', () => {
    expect(summarise(undefined)).toBeUndefined();
    expect(summarise({ type: 'Banana', coordinates: [] })).toBeUndefined();
    expect(summarise('x')).toBeUndefined();
  });
});

describe('draw tool in a form', () => {
  it.each(['de', 'en'])('says where it is drawn when empty, in %s', async (locale) => {
    expect((await render(locale)).text).toBe(catalogue(locale)['draw_empty']);
  });

  it.each(['de', 'en'])('shows the kind, parts and positions of the value, in %s', async (locale) => {
    const cat = catalogue(locale);
    const { text, produced } = await render(locale, { type: 'MultiPolygon', coordinates: [[ring], [ring]] });
    expect(text).toBe(
      (cat['draw_summary'] ?? '')
        .replace('{kind}', cat['draw_kindArea'] ?? '')
        .replace('{parts}', '2')
        .replace('{points}', '6'),
    );
    expect(produced).toEqual([]);
  });
});
