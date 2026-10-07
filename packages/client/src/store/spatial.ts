/**
 * Incremental spatial index behind `Facts.near`: a uniform lon/lat grid per feature type. Puts and deletes
 * touch only the cells of one feature; a lookup visits only the cells of the probe. Features that span many
 * cells go to a per-type `wide` list, which stays short. No O(N) scan per call for viewport-sized probes.
 */
import { bboxOf, unionBbox } from '@ueberblick/core/geo/bbox';
import type { Bbox, Geometry } from '@ueberblick/core/geo';
import type { FeatureId, FeatureState, Json } from '@ueberblick/core/model';
import { GEO_GEOMETRY_TYPES } from '@ueberblick/core/registry';
import { isServed } from '@ueberblick/core/registry';

const CELL_DEG = 0.002;
const ROW = 100_000;
const WIDE_CELLS = 64;
const MAX_PROBE_CELLS = 4096;

type Box = [number, number, number, number];
const at = (a: ArrayLike<number>, i: number): number => a[i] ?? 0;
const cellX = (lon: number): number => Math.floor((lon + 180) / CELL_DEG);
const cellY = (lat: number): number => Math.floor((lat + 90) / CELL_DEG);

const isGeometry = (v: Json): boolean =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  GEO_GEOMETRY_TYPES.has(String((v as { readonly type?: Json }).type));

/** Union 2D bbox of every geometry-valued property of a feature; undefined when it has none. */
export function featureBbox(f: FeatureState): Bbox | undefined {
  let first: Bbox | undefined;
  let rest: (Bbox | undefined)[] | undefined;
  for (const k in f.properties) {
    const v = f.properties[k];
    if (v === undefined || !isGeometry(v)) continue;
    const b = bboxOf(v as unknown as Geometry);
    if (first === undefined && rest === undefined) first = b;
    else (rest ??= [first]).push(b);
  }
  // the usual feature has one geometry: no union, no list
  return rest === undefined ? first : unionBbox(rest);
}

/** Edge contact counts as intersecting. */
export const bboxMeets = (a: Bbox, b: Bbox): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

class TypeGrid {
  readonly cells = new Map<number, FeatureId[]>();
  readonly wide = new Set<FeatureId>();
}

/**
 * Bboxes live in one packed Float64Array (a slot per feature), so 60k features cost a few hundred KB;
 * the cells of a feature are recomputed from its bbox on delete instead of being stored.
 */
export class SpatialIndex {
  private readonly slotOf = new Map<FeatureId, number>();
  private readonly types: string[] = [];
  private boxes = new Float64Array(4 * 1024);
  private readonly free: number[] = [];
  private readonly grids = new Map<string, TypeGrid>();

  /** One scratch tuple, refilled per call: a put or delete per feature must not allocate (WP-858). Read it at once. */
  private readonly scratch: Box = [0, 0, 0, 0];

  private range(s: number): Box {
    const b = this.boxes;
    const r = this.scratch;
    r[0] = cellX(at(b, 4 * s));
    r[1] = cellY(at(b, 4 * s + 1));
    r[2] = cellX(at(b, 4 * s + 2));
    r[3] = cellY(at(b, 4 * s + 3));
    return r;
  }

  put(f: FeatureState): void {
    this.delete(f.id);
    if (!isServed(f.lifecycle)) return;
    const bbox = featureBbox(f);
    if (!bbox) return;
    const s = this.free.pop() ?? this.types.length;
    if (4 * s + 4 > this.boxes.length) {
      const grown = new Float64Array(this.boxes.length * 2);
      grown.set(this.boxes);
      this.boxes = grown;
    }
    this.boxes.set(bbox, 4 * s);
    this.types[s] = f.type;
    this.slotOf.set(f.id, s);
    let grid = this.grids.get(f.type);
    if (!grid) {
      grid = new TypeGrid();
      this.grids.set(f.type, grid);
    }
    const [x0, y0, x1, y1] = this.range(s);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > WIDE_CELLS) {
      grid.wide.add(f.id);
      return;
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cell = grid.cells.get(y * ROW + x);
        if (cell) cell.push(f.id);
        else grid.cells.set(y * ROW + x, [f.id]);
      }
  }

  delete(id: FeatureId): void {
    const s = this.slotOf.get(id);
    if (s === undefined) return;
    this.slotOf.delete(id);
    const grid = this.grids.get(this.types[s] ?? '');
    this.free.push(s);
    if (!grid || grid.wide.delete(id)) return;
    const [x0, y0, x1, y1] = this.range(s);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cell = grid.cells.get(y * ROW + x);
        if (!cell) continue;
        const i = cell.indexOf(id);
        if (i >= 0) {
          cell[i] = cell[cell.length - 1] ?? id;
          cell.pop();
        }
        if (cell.length === 0) grid.cells.delete(y * ROW + x);
      }
  }

  clear(): void {
    this.slotOf.clear();
    this.types.length = 0;
    this.free.length = 0;
    this.grids.clear();
  }

  private meets(id: FeatureId, q: Bbox): boolean {
    const s = this.slotOf.get(id);
    if (s === undefined) return false;
    const b = this.boxes;
    return (
      at(b, 4 * s) <= q[2] && at(b, 4 * s + 2) >= q[0] && at(b, 4 * s + 1) <= q[3] && at(b, 4 * s + 3) >= q[1]
    );
  }

  /** Ids of `type` whose bbox intersects `bbox`. */
  query(type: string, bbox: Bbox): FeatureId[] {
    const grid = this.grids.get(type);
    if (!grid) return [];
    const out = new Set<FeatureId>();
    const x0 = cellX(bbox[0]);
    const x1 = cellX(bbox[2]);
    const y0 = cellY(bbox[1]);
    const y1 = cellY(bbox[3]);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_PROBE_CELLS) {
      // A probe larger than any viewport: hits dominate the cost anyway.
      for (const [id, s] of this.slotOf) if (this.types[s] === type && this.meets(id, bbox)) out.add(id);
      return [...out];
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cell = grid.cells.get(y * ROW + x);
        if (cell) for (const id of cell) if (this.meets(id, bbox)) out.add(id);
      }
    for (const id of grid.wide) if (this.meets(id, bbox)) out.add(id);
    return [...out];
  }
}
