/**
 * Layout of one process diagram: columns by distance from the default option along the arrows, one
 * row per node in a column. Pure geometry, so it is tested without a DOM.
 */
import type { Process, ProcessEdge } from './graph';

export const NODE = { width: 140, height: 56, gapX: 90, gapY: 36, margin: 24, anywhere: 44 } as const;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  /** Top-left corner of each node by option key. */
  readonly nodes: ReadonlyMap<string, Point>;
}

export function layout(process: Process): Layout {
  const options = process.nodes.map((n) => n.option);
  const next = new Map<string, string[]>();
  for (const e of process.edges) {
    if (e.from === undefined) continue;
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  }
  const start = process.nodes.find((n) => n.isStart)?.option ?? options[0];
  const depth = new Map<string, number>();
  const visit = (root: string): void => {
    if (depth.has(root)) return;
    depth.set(root, 0);
    const queue = [root];
    for (let i = 0; i < queue.length; i += 1) {
      const at = queue[i] as string;
      for (const to of next.get(at) ?? []) {
        if (depth.has(to)) continue;
        depth.set(to, (depth.get(at) ?? 0) + 1);
        queue.push(to);
      }
    }
  };
  if (start !== undefined) visit(start);
  for (const o of options) visit(o);

  const rows = new Map<number, number>();
  const nodes = new Map<string, Point>();
  let columns = 0;
  for (const o of options) {
    const col = depth.get(o) ?? 0;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    columns = Math.max(columns, col + 1);
    nodes.set(o, {
      x: NODE.margin + NODE.anywhere + col * (NODE.width + NODE.gapX),
      y: NODE.margin + row * (NODE.height + NODE.gapY),
    });
  }
  const tallest = Math.max(1, ...rows.values());
  return {
    nodes,
    width: 2 * NODE.margin + NODE.anywhere + columns * NODE.width + Math.max(0, columns - 1) * NODE.gapX,
    height: 2 * NODE.margin + tallest * NODE.height + (tallest - 1) * NODE.gapY,
  };
}

export interface EdgeShape {
  /** SVG path data. */
  readonly d: string;
  readonly label: Point;
}

const center = (p: Point): Point => ({ x: p.x + NODE.width / 2, y: p.y + NODE.height / 2 });

/** Where the line from a node's centre towards `toward` leaves its rectangle. */
function border(p: Point, toward: Point): Point {
  const c = center(p);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const t = Math.min(NODE.width / 2 / Math.abs(dx || Infinity), NODE.height / 2 / Math.abs(dy || Infinity));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * The curve of one arrow. `slot` (0, 1, 2 ...) bends arrows between the same two nodes apart; an
 * arrow from anywhere starts as a short stub to the left of its target.
 */
export function edgeShape(edge: ProcessEdge, layoutOf: Layout, slot: number): EdgeShape | undefined {
  const to = layoutOf.nodes.get(edge.to);
  if (to === undefined) return undefined;
  if (edge.from === undefined) {
    const y = to.y + NODE.height / 2 + slot * 10 - 5;
    const tail = { x: to.x - NODE.anywhere + 4, y };
    return { d: `M${tail.x},${y} L${to.x},${y}`, label: { x: tail.x, y: y - 4 } };
  }
  const from = layoutOf.nodes.get(edge.from);
  if (from === undefined) return undefined;
  if (edge.from === edge.to) {
    const x = from.x + NODE.width / 2 + slot * 14;
    const top = from.y;
    return {
      d: `M${x - 18},${top} C${x - 18},${top - 26} ${x + 18},${top - 26} ${x + 18},${top}`,
      label: { x, y: top - 22 },
    };
  }
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * 22 + 12;
  const mid = { x: (a.x + b.x) / 2 - (dy / len) * bend, y: (a.y + b.y) / 2 + (dx / len) * bend };
  const s = border(from, mid);
  const e = border(to, mid);
  return { d: `M${s.x},${s.y} Q${mid.x},${mid.y} ${e.x},${e.y}`, label: { x: mid.x, y: mid.y - 4 } };
}
