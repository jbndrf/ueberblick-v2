/** WKT geometry literals (2D and Z) and ENVELOPE / BBOX of the CQL2 text encoding. */
import type { Expr, Span } from '../ast';
import { GEO_GEOMETRY_TYPES } from '../../registry';
import { bbox, geometry } from './build';
import type { Cursor } from './cursor';

/** Upper-case WKT keyword -> GeoJSON type. Derived from the registry, never listed twice. */
const WKT_TYPES: ReadonlyMap<string, string> = new Map(
  GEO_GEOMETRY_TYPES.keys.map((k) => [k.toUpperCase(), k]),
);

/** True when the current token starts a WKT geometry (`POINT (`, `POINT Z (`, `POINT EMPTY`). */
export function startsGeometry(c: Cursor): boolean {
  if (c.tok.kind !== 'id' || !WKT_TYPES.has(c.tok.text.toUpperCase())) return false;
  const n = c.peek();
  return (
    c.isPunct('(', n) || c.isWord('Z', n) || c.isWord('EMPTY', n) || c.isWord('M', n) || c.isWord('ZM', n)
  );
}

/** One signed number token. */
export function number(c: Cursor): { value: number; span: Span } {
  const start = c.tok.span.start;
  let sign = 1;
  if (c.isPunct('-')) {
    c.next();
    sign = -1;
  } else if (c.isPunct('+')) c.next();
  const t = c.tok;
  if (t.kind !== 'num') return c.failHere(`expected a number but found ${c.describeHere()}`);
  c.next();
  return { value: sign * Number(t.text), span: { start, end: t.span.end } };
}

function position(c: Cursor): readonly number[] {
  const first = number(c);
  const coords = [first.value];
  let end = first.span.end;
  while (c.tok.kind === 'num' || c.isPunct('-') || c.isPunct('+')) {
    const n = number(c);
    coords.push(n.value);
    end = n.span.end;
  }
  if (coords.length < 2 || coords.length > 3) {
    return c.failHere(`a position needs 2 or 3 coordinates, found ${String(coords.length)}`, {
      start: first.span.start,
      end,
    });
  }
  return coords;
}

/** `( item , item , … )` */
function list<T>(c: Cursor, item: () => T): T[] {
  c.expectPunct('(');
  const out = [item()];
  while (c.isPunct(',')) {
    c.next();
    out.push(item());
  }
  c.expectPunct(')');
  return out;
}

const positions = (c: Cursor) => list(c, () => position(c));
const rings = (c: Cursor) => list(c, () => positions(c));
const polygons = (c: Cursor) => list(c, () => rings(c));

function wktGeometry(c: Cursor): Record<string, unknown> {
  return c.guarded(() => {
    const t = c.next();
    const type = WKT_TYPES.get(t.text.toUpperCase());
    if (type === undefined) return c.failHere(`unknown geometry type '${t.text}'`, t.span);
    if (c.isWord('Z')) c.next();
    else if (c.isWord('M') || c.isWord('ZM'))
      return c.failHere('measured (M) geometries are not supported', c.tok.span);
    if (c.isWord('EMPTY')) return c.failHere('EMPTY geometries are not supported', c.tok.span);
    switch (type) {
      case 'Point': {
        c.expectPunct('(');
        const p = position(c);
        c.expectPunct(')');
        return { type, coordinates: p };
      }
      case 'LineString':
        return { type, coordinates: positions(c) };
      case 'MultiPoint':
        // both `MULTIPOINT((1 2),(3 4))` and `MULTIPOINT(1 2, 3 4)` are in use
        return {
          type,
          coordinates: list(c, () => {
            if (!c.isPunct('(')) return position(c);
            c.next();
            const p = position(c);
            c.expectPunct(')');
            return p;
          }),
        };
      case 'Polygon':
        return { type, coordinates: rings(c) };
      case 'MultiLineString':
        return { type, coordinates: rings(c) };
      case 'MultiPolygon':
        return { type, coordinates: polygons(c) };
      default:
        return { type, geometries: list(c, () => wktGeometry(c)) };
    }
  });
}

/** A WKT geometry as a map literal. */
export function wkt(c: Cursor): Expr {
  const start = c.tok.span.start;
  const g = wktGeometry(c);
  const end = c.peek(-1).span.end;
  return geometry(g, { start, end }, 'geometry');
}

/** `BBOX(w,s,e,n)` and `ENVELOPE(w,s,e,n)`; the name token is already consumed. */
export function box(c: Cursor, start: number): Expr {
  c.expectPunct('(');
  const values = [number(c).value];
  while (c.isPunct(',')) {
    c.next();
    values.push(number(c).value);
  }
  const close = c.expectPunct(')');
  return bbox(values, { start, end: close.span.end });
}
