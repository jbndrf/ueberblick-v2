/**
 * Well-known binary and the GeoPackage geometry blob (OGC 12-128r18 §2.1.3). Z is kept in both directions (H1).
 * Reads ISO WKB (type + 1000 for Z) and EWKB (Z flag); M values are dropped. Writes little-endian ISO WKB.
 */
import type { Geometry, Position } from '@ueberblick/core';

const TYPES = [
  'Point',
  'LineString',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
  'GeometryCollection',
] as const;
type WkbName = (typeof TYPES)[number];
const CODE: Record<WkbName, number> = {
  Point: 1,
  LineString: 2,
  Polygon: 3,
  MultiPoint: 4,
  MultiLineString: 5,
  MultiPolygon: 6,
  GeometryCollection: 7,
};

class Reader {
  offset = 0;
  constructor(readonly view: DataView) {}
  le = true;
  u8(): number {
    return this.view.getUint8(this.offset++);
  }
  u32(): number {
    const v = this.view.getUint32(this.offset, this.le);
    this.offset += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.offset, this.le);
    this.offset += 8;
    return v;
  }
}

function readPosition(r: Reader, z: boolean, m: boolean): Position {
  const x = r.f64();
  const y = r.f64();
  const zv = z ? r.f64() : Number.NaN;
  if (m) r.f64();
  return z && !Number.isNaN(zv) ? [x, y, zv] : [x, y];
}

/** The coordinates of a part of a Multi* geometry (the part's kind is fixed by the parent). */
function partCoordinates<T>(g: Geometry): T {
  return (g as unknown as { coordinates: T }).coordinates;
}

function readGeometry(r: Reader): Geometry {
  r.le = r.u8() === 1;
  let code = r.u32();
  let z = false;
  let m = false;
  if (code & 0x80000000) z = true;
  if (code & 0x40000000) m = true;
  code &= 0x0fffffff; // drop the EWKB flags (an SRID flag is not used in GeoPackage)
  const iso = Math.floor(code / 1000);
  if (iso === 1 || iso === 3) z = true;
  if (iso === 2 || iso === 3) m = true;
  code %= 1000;
  const name = TYPES[code - 1];
  if (name === undefined) throw new Error(`unsupported WKB geometry type ${code}`);
  const ring = (): Position[] => Array.from({ length: r.u32() }, () => readPosition(r, z, m));
  const rings = (): Position[][] => Array.from({ length: r.u32() }, ring);
  switch (name) {
    case 'Point': {
      const p = readPosition(r, z, m);
      if (Number.isNaN(p[0]) || Number.isNaN(p[1])) throw new Error('empty point');
      return { type: 'Point', coordinates: p };
    }
    case 'LineString':
      return { type: 'LineString', coordinates: ring() };
    case 'Polygon':
      return { type: 'Polygon', coordinates: rings() };
    case 'MultiPoint':
      return {
        type: 'MultiPoint',
        coordinates: Array.from({ length: r.u32() }, () => partCoordinates<Position>(readGeometry(r))),
      };
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: Array.from({ length: r.u32() }, () => partCoordinates<Position[]>(readGeometry(r))),
      };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: Array.from({ length: r.u32() }, () => partCoordinates<Position[][]>(readGeometry(r))),
      };
    case 'GeometryCollection':
      return {
        type: 'GeometryCollection',
        geometries: Array.from({ length: r.u32() }, () => readGeometry(r)),
      };
  }
}

export function fromWkb(bytes: Uint8Array): Geometry {
  return readGeometry(new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
}

const hasZ = (g: Geometry): boolean => {
  switch (g.type) {
    case 'Point':
      return g.coordinates.length === 3;
    case 'MultiPoint':
    case 'LineString':
      return g.coordinates.some((p) => p.length === 3);
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates.some((l) => l.some((p) => p.length === 3));
    case 'MultiPolygon':
      return g.coordinates.some((pg) => pg.some((l) => l.some((p) => p.length === 3)));
    case 'GeometryCollection':
      return g.geometries.some(hasZ);
  }
};

class Writer {
  private chunks: number[] = [];
  private buf = new DataView(new ArrayBuffer(8));
  u8(v: number): void {
    this.chunks.push(v);
  }
  u32(v: number): void {
    this.buf.setUint32(0, v, true);
    for (let i = 0; i < 4; i++) this.chunks.push(this.buf.getUint8(i));
  }
  f64(v: number): void {
    this.buf.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.chunks.push(this.buf.getUint8(i));
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

function writeGeometry(w: Writer, g: Geometry, z: boolean): void {
  w.u8(1);
  w.u32(CODE[g.type] + (z ? 1000 : 0));
  const pos = (p: Position): void => {
    w.f64(p[0]);
    w.f64(p[1]);
    if (z) w.f64(p.length === 3 ? p[2] : Number.NaN);
  };
  const line = (l: readonly Position[]): void => {
    w.u32(l.length);
    l.forEach(pos);
  };
  switch (g.type) {
    case 'Point':
      return pos(g.coordinates);
    case 'LineString':
      return line(g.coordinates);
    case 'Polygon':
      w.u32(g.coordinates.length);
      return g.coordinates.forEach(line);
    case 'MultiPoint':
      w.u32(g.coordinates.length);
      return g.coordinates.forEach((p) => writeGeometry(w, { type: 'Point', coordinates: p }, z));
    case 'MultiLineString':
      w.u32(g.coordinates.length);
      return g.coordinates.forEach((l) => writeGeometry(w, { type: 'LineString', coordinates: l }, z));
    case 'MultiPolygon':
      w.u32(g.coordinates.length);
      return g.coordinates.forEach((p) => writeGeometry(w, { type: 'Polygon', coordinates: p }, z));
    case 'GeometryCollection':
      w.u32(g.geometries.length);
      return g.geometries.forEach((m) => writeGeometry(w, m, z));
  }
}

export function toWkb(g: Geometry): Uint8Array {
  const w = new Writer();
  writeGeometry(w, g, hasZ(g));
  return w.bytes();
}

const GPKG_MAGIC = [0x47, 0x50] as const;

/** GeoPackage geometry blob: header (no envelope, little-endian) + WKB. */
export function toGpkgBlob(g: Geometry, srsId: number): Uint8Array {
  const wkb = toWkb(g);
  const out = new Uint8Array(8 + wkb.length);
  out.set(GPKG_MAGIC, 0);
  out[2] = 0; // version 1
  out[3] = 1; // little-endian, no envelope, not empty, standard binary
  new DataView(out.buffer).setInt32(4, srsId, true);
  out.set(wkb, 8);
  return out;
}

const ENVELOPE_BYTES = [0, 32, 48, 48, 64] as const;

/** Reads the geometry blob; `undefined` for a NULL blob or an empty geometry. */
export function fromGpkgBlob(blob: Uint8Array): { geometry: Geometry; srsId: number } | undefined {
  if (blob.length < 8 || blob[0] !== GPKG_MAGIC[0] || blob[1] !== GPKG_MAGIC[1]) {
    throw new Error('not a GeoPackage geometry blob');
  }
  const flags = blob[3] as number;
  if (flags & 0x10) return undefined; // empty geometry
  const le = (flags & 1) === 1;
  const srsId = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getInt32(4, le);
  const env = ENVELOPE_BYTES[(flags >> 1) & 7];
  if (env === undefined) throw new Error('bad envelope indicator');
  return { geometry: fromWkb(blob.subarray(8 + env)), srsId };
}
