/**
 * Automatic positions of the canvas nodes. v3 stored each stage's position (`setStagePosition`);
 * v4 has no place for it yet (E-21), so the columns come from the process layout
 * (`lenses/process/layout.ts`: distance from the start along the arrows) and only the sizes are
 * v3's: a 220 px card whose height grows with its task buttons. Global container, rules and entry
 * markers sit to the left of the stages as in v3 (`TaskCanvas.svelte` `minX - 300`).
 */
import { layout, NODE } from '../../lenses/process/layout';
import { nodeId, type CanvasModel } from './model';

export const CARD = {
  width: 220,
  gapX: 110,
  gapY: 40,
  header: 40,
  button: 34,
  link: 24,
  empty: 4,
  pad: 10,
} as const;
const ENTRY = { width: 170, gap: 60, step: 70 } as const;
const RULE = { height: 80, step: 90 } as const;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The card height, close to what its content renders at (the canvas measures the real one). */
export const cardHeight = (tasks: number, linked = 0): number =>
  CARD.header + CARD.pad + Math.max(tasks, 0) * CARD.button + Math.max(linked, 0) * CARD.link + CARD.empty;

/** The buttons that show a 'verknüpft' line under them (a sub-process link wraps onto its own row). */
const linkedOf = (tasks: readonly { readonly child?: unknown }[]): number =>
  tasks.filter((t) => t.child !== undefined).length;

export function arrange(model: CanvasModel): ReadonlyMap<string, Point> {
  const out = new Map<string, Point>();
  const grid = model.process === undefined ? undefined : layout(model.process);
  const columns = new Map<number, number>();
  let minX = 0;
  for (const stage of model.stages) {
    const at = grid?.nodes.get(stage.key);
    const col =
      at === undefined ? 0 : Math.round((at.x - NODE.margin - NODE.anywhere) / (NODE.width + NODE.gapX));
    const y = columns.get(col) ?? 0;
    columns.set(col, y + cardHeight(stage.tasks.length, linkedOf(stage.tasks)) + CARD.gapY);
    const x = col * (CARD.width + CARD.gapX);
    out.set(nodeId.stage(stage.key), { x, y });
    minX = Math.min(minX, x);
  }
  const left = minX - ENTRY.width - ENTRY.gap - CARD.gapX - CARD.width;
  out.set(nodeId.global, { x: left, y: 0 });
  const below = cardHeight(model.global.length, linkedOf(model.global)) + CARD.gapY;
  model.rules.forEach((r, i) => out.set(nodeId.rule(r.key), { x: left, y: below + i * RULE.step }));
  const start = model.stages.find((s) => s.kind === 'start');
  const startAt = start === undefined ? undefined : out.get(nodeId.stage(start.key));
  model.entries.forEach((e, i) => {
    out.set(
      nodeId.entry(e.key),
      startAt === undefined
        ? { x: left, y: -ENTRY.step * (i + 1) }
        : { x: startAt.x - ENTRY.width - ENTRY.gap, y: startAt.y + i * ENTRY.step },
    );
  });
  return out;
}
