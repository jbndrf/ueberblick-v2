// The draw tool of a geometry field in a form (WP-635). Drawing a line or an area happens on the live map, not in the
// form (`DrawOnMap` in the app, v3 `geometry-draw-tool.svelte`), because a sketch without the basemap cannot place a
// hedge or an area. The field shows what the drawn value is and says where it is drawn. It never writes a value.
import type { JsonValue } from '@ueberblick/core/model';
import { defineTool, type FieldTool } from '@ueberblick/ui/tool-api';
import { message } from './messages';

export interface Summary {
  readonly kind: 'point' | 'line' | 'area';
  readonly parts: number;
  readonly points: number;
}

const isObject = (v: JsonValue | undefined): v is { [k: string]: JsonValue } =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const count = (list: JsonValue | undefined): number => (Array.isArray(list) ? list.length : 0);
const sum = (list: readonly JsonValue[], each: (x: JsonValue) => number): number =>
  list.reduce<number>((n, x) => n + each(x), 0);
/** Positions of one polygon without the closing position of each ring. */
const areaPoints = (rings: JsonValue): number =>
  Array.isArray(rings) ? sum(rings, (r) => Math.max(0, count(r) - 1)) : 0;

/** What a stored geometry is, in the words of the form; `undefined` when it is not a point, line or area. */
export function summarise(value: JsonValue | undefined): Summary | undefined {
  if (!isObject(value) || !Array.isArray(value['coordinates'])) return undefined;
  const c = value['coordinates'];
  switch (value['type']) {
    case 'Point':
      return { kind: 'point', parts: 1, points: 1 };
    case 'LineString':
      return { kind: 'line', parts: 1, points: c.length };
    case 'MultiLineString':
      return { kind: 'line', parts: c.length, points: sum(c, count) };
    case 'Polygon':
      return { kind: 'area', parts: 1, points: areaPoints(c) };
    case 'MultiPolygon':
      return { kind: 'area', parts: c.length, points: sum(c, areaPoints) };
    default:
      return undefined;
  }
}

const KIND = { point: 'kindPoint', line: 'kindLine', area: 'kindArea' } as const;

export const drawTool: FieldTool = defineTool({
  key: 'draw',
  contributes: ['form-field'],
  produces: 'geometry',
  mount(root, ctx) {
    const p = document.createElement('p');
    p.dataset['testid'] = 'draw-summary';
    const s = summarise(ctx.value);
    p.textContent =
      s === undefined
        ? message(ctx.locale, 'empty')
        : message(ctx.locale, 'summary', {
            kind: message(ctx.locale, KIND[s.kind]),
            parts: s.parts,
            points: s.points,
          });
    root.append(p);
    return { destroy: () => p.remove() };
  },
});
