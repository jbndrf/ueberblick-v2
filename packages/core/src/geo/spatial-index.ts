/**
 * A static bbox index (sort-tile-recursive packed R-tree) in front of the engine: the tree prunes to the few
 * entries whose bbox meets the probe, then the engine decides exactly. Never a scan over all entries.
 */
import type { Bbox, GeoEngine, Geometry, SpatialIndex } from './contract';
import { bboxOf } from './bbox';
import { at } from './coords';
import { distanceM } from './distance';
import type { GeoPredicate } from '../registry';

const NODE_SIZE = 16;

interface Node {
  readonly bbox: Bbox;
  /** Leaf: entry indices. Inner: child nodes. */
  readonly entries?: readonly number[];
  readonly children?: readonly Node[];
}

const union = (boxes: readonly Bbox[]): Bbox => [
  Math.min(...boxes.map((b) => b[0])),
  Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])),
  Math.max(...boxes.map((b) => b[3])),
];

const RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_008.8;
/** Slack so the bound stays below the engine's distance despite its equirectangular approximation. */
const BOUND_SLACK = 0.98;

/** A lower bound of the metres between two boxes (0 when they meet); never above `distanceM` of anything inside. */
function lowerBoundM(a: Bbox, b: Bbox): number {
  let dx = Math.max(a[0] - b[2], b[0] - a[2], 0);
  const dy = Math.max(a[1] - b[3], b[1] - a[3], 0);
  if (dx > 180) dx = 0; // across the antimeridian: no useful bound
  if (dx === 0 && dy === 0) return 0;
  const maxLat = Math.min(89.9, Math.max(Math.abs(a[1]), Math.abs(a[3]), Math.abs(b[1]), Math.abs(b[3])));
  const k = Math.cos(maxLat * RAD);
  return BOUND_SLACK * Math.hypot(dx * k, dy) * RAD * EARTH_RADIUS_M;
}

/** Minimal binary min-heap on a numeric priority. */
class MinHeap<T> {
  private readonly prio: number[] = [];
  private readonly items: T[] = [];
  get size() {
    return this.items.length;
  }
  peek(): number {
    return this.prio[0] ?? Infinity;
  }
  push(p: number, item: T): void {
    let i = this.items.length;
    this.prio.push(p);
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (at(this.prio, parent) <= p) break;
      this.prio[i] = at(this.prio, parent);
      this.items[i] = at(this.items, parent);
      i = parent;
    }
    this.prio[i] = p;
    this.items[i] = item;
  }
  pop(): T | undefined {
    const top = this.items[0];
    const p = this.prio.pop();
    const item = this.items.pop();
    const n = this.items.length;
    if (n === 0 || p === undefined || item === undefined) return top;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && at(this.prio, c + 1) < at(this.prio, c)) c++;
      if (at(this.prio, c) >= p) break;
      this.prio[i] = at(this.prio, c);
      this.items[i] = at(this.items, c);
      i = c;
    }
    this.prio[i] = p;
    this.items[i] = item;
    return top;
  }
}

const meets = (a: Bbox, b: Bbox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

function pack<T>(items: readonly T[], box: (t: T) => Bbox, make: (chunk: T[], bbox: Bbox) => Node): Node[] {
  const n = items.length;
  const slices = Math.ceil(Math.sqrt(n / NODE_SIZE));
  const sliceSize = slices * NODE_SIZE;
  const byX = [...items].sort((a, b) => box(a)[0] + box(a)[2] - (box(b)[0] + box(b)[2]));
  const out: Node[] = [];
  for (let i = 0; i < n; i += sliceSize) {
    const slice = byX.slice(i, i + sliceSize).sort((a, b) => box(a)[1] + box(a)[3] - (box(b)[1] + box(b)[3]));
    for (let j = 0; j < slice.length; j += NODE_SIZE) {
      const chunk = slice.slice(j, j + NODE_SIZE);
      out.push(make(chunk, union(chunk.map(box))));
    }
  }
  return out;
}

export function buildIndex<K>(engine: GeoEngine, source: Iterable<readonly [K, Geometry]>): SpatialIndex<K> {
  const keys: K[] = [];
  const geoms: Geometry[] = [];
  const boxes: Bbox[] = [];
  for (const [k, g] of source) {
    const b = bboxOf(g);
    if (!b) continue; // an empty geometry satisfies no predicate with anything
    keys.push(k);
    geoms.push(g);
    boxes.push(b);
  }

  let level: Node[] = pack(
    keys.map((_, i) => i),
    (i) => at(boxes, i),
    (chunk, bbox) => ({ bbox, entries: chunk }),
  );
  while (level.length > 1)
    level = pack(
      level,
      (nd) => nd.bbox,
      (chunk, bbox) => ({ bbox, children: chunk }),
    );
  const root = level[0];

  const candidates = (probe: Bbox): number[] => {
    const hit: number[] = [];
    if (!root) return hit;
    const stack: Node[] = [root];
    for (let nd = stack.pop(); nd; nd = stack.pop()) {
      if (!meets(nd.bbox, probe)) continue;
      if (nd.entries) {
        for (const i of nd.entries) if (meets(at(boxes, i), probe)) hit.push(i);
      } else if (nd.children) {
        stack.push(...nd.children);
      }
    }
    return hit;
  };

  /** Branch and bound: visit nodes and entries by bbox lower bound, stop when the best exact distance is below it. */
  const nearest = (probe: Geometry): { key: K; distanceM: number } | undefined => {
    const pb = bboxOf(probe);
    if (!pb || !root) return undefined;
    const heap = new MinHeap<Node | number>();
    heap.push(lowerBoundM(root.bbox, pb), root);
    let best: { i: number; d: number } | undefined;
    while (heap.size > 0 && (!best || heap.peek() <= best.d)) {
      const item = heap.pop();
      if (typeof item === 'number') {
        const d = distanceM(engine, probe, at(geoms, item));
        if (!best || d < best.d || (d === best.d && item < best.i)) best = { i: item, d };
      } else if (item?.entries) {
        for (const i of item.entries) heap.push(lowerBoundM(at(boxes, i), pb), i);
      } else if (item?.children) {
        for (const c of item.children) heap.push(lowerBoundM(c.bbox, pb), c);
      }
    }
    return best && { key: at(keys, best.i), distanceM: best.d };
  };

  return {
    size: keys.length,
    nearest,
    query(predicate: GeoPredicate, probe: Geometry): readonly K[] {
      const pb = bboxOf(probe);
      if (!pb) return [];
      const near = candidates(pb);
      if (predicate === 'disjoint') {
        // Everything outside the bbox neighbourhood is disjoint by construction; only the neighbours need the engine.
        const touching = new Set(near.filter((i) => !engine.test('disjoint', probe, at(geoms, i))));
        return keys.filter((_, i) => !touching.has(i));
      }
      return near.filter((i) => engine.test(predicate, probe, at(geoms, i))).map((i) => at(keys, i));
    },
  };
}
