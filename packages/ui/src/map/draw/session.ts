// The state of one drawing session: parts (v3 "Elemente"), the active one, and an undo/redo history per part, as
// v3's `geometry-draw-tool.svelte` kept them (entities with snapshot histories, :80-116, :253-346). DOM-free.
import type { Geo, Position } from '@ueberblick/core/geo';
import { committable, evaluate, MIN_VERTICES, type DrawKind, type Outcome, type Part } from './model';

interface Entry {
  readonly part: Part;
  /** Snapshots of the part; `at` is the one shown. The first is the empty part. */
  readonly history: readonly Part[];
  readonly at: number;
}

const EMPTY: Part = { points: [], closed: false };
const fresh = (): Entry => ({ part: EMPTY, history: [EMPTY], at: 0 });

export interface DrawSession {
  readonly kind: DrawKind;
  /** The property takes several parts (Multi*): Neues Element and the part tabs are offered. */
  readonly multi: boolean;
  parts(): readonly Part[];
  /** Index of the part vertices are added to. */
  active(): number;
  canUndo(): boolean;
  canRedo(): boolean;
  /** At least one part has enough vertices: Fertig is enabled. */
  canFinish(): boolean;
  /** Validity of what Fertig would store, through core.geo. */
  outcome(geo: Geo): Outcome;
  /** A tap on the map: one more vertex on the active part. */
  add(at: Position): void;
  /** Neues Element: starts another part. An empty active part is kept instead (no empty tabs); a stub below the minimum is dropped. */
  newPart(): void;
  activate(index: number): void;
  /** Element löschen: removes the active part and renumbers; a fresh part takes over when none is left. */
  deleteActive(): void;
  undo(): void;
  redo(): void;
  /** Tap on the first vertex of an area with enough vertices: closes the ring and, for a multi-part property, starts the next part. */
  closeRing(index: number): boolean;
  /** Live move of a vertex while it is dragged; the first move of a gesture records the undo step. */
  moveVertex(part: number, vertex: number, at: Position): void;
  /** The drag ended: the next move is a new undo step. */
  endMove(): void;
  subscribe(listener: () => void): () => void;
}

/** `initial`: parts a shape being redrawn starts with (`partsOf`); the first is active. */
export function createSession(kind: DrawKind, multi: boolean, initial: readonly Part[] = []): DrawSession {
  let entries: Entry[] =
    initial.length === 0 ? [fresh()] : initial.map((part) => ({ part, history: [part], at: 0 }));
  let active = 0;
  let moving = false;
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((f) => f());
  const min = MIN_VERTICES[kind];
  const current = (): Entry => entries[active] as Entry;

  /** Replaces the part at `i`: as a new undo step, or in place (a drag in progress). */
  const set = (i: number, part: Part, record: boolean): void => {
    entries = entries.map((e, j) => {
      if (j !== i) return e;
      if (!record) return { ...e, part, history: e.history.map((h, k) => (k === e.at ? part : h)) };
      const kept = e.history.slice(0, e.at + 1);
      return { part, history: [...kept, part], at: kept.length };
    });
  };
  const goto = (to: number): void => {
    entries = entries.map((e, j) => (j === active ? { ...e, at: to, part: e.history[to] as Part } : e));
    notify();
  };

  return {
    kind,
    multi,
    parts: () => entries.map((e) => e.part),
    active: () => active,
    canUndo: () => current().at > 0,
    canRedo: () => current().at < current().history.length - 1,
    canFinish: () =>
      committable(
        entries.map((e) => e.part),
        kind,
      ).length > 0,
    outcome: (geo) =>
      evaluate(
        geo,
        entries.map((e) => e.part),
        kind,
        multi,
      ),
    add(at) {
      moving = false;
      set(active, { points: [...current().part.points, at], closed: current().part.closed }, true);
      notify();
    },
    newPart() {
      if (!multi) return;
      const n = current().part.points.length;
      if (n === 0) return;
      if (n < min) entries = entries.filter((_, j) => j !== active);
      entries = [...entries, fresh()];
      active = entries.length - 1;
      notify();
    },
    activate(index) {
      if (index < 0 || index >= entries.length) return;
      active = index;
      notify();
    },
    deleteActive() {
      entries = entries.filter((_, j) => j !== active);
      if (entries.length === 0) entries = [fresh()];
      active = entries.length - 1;
      notify();
    },
    undo() {
      if (current().at > 0) goto(current().at - 1);
    },
    redo() {
      if (current().at < current().history.length - 1) goto(current().at + 1);
    },
    closeRing(index) {
      const e = entries[index];
      if (kind !== 'polygon' || e === undefined || e.part.points.length < min) return false;
      set(index, { points: e.part.points, closed: true }, true);
      if (multi) {
        entries = [...entries, fresh()];
        active = entries.length - 1;
      }
      notify();
      return true;
    },
    moveVertex(part, vertex, at) {
      const e = entries[part];
      if (e === undefined || e.part.points[vertex] === undefined) return;
      set(
        part,
        { points: e.part.points.map((p, i) => (i === vertex ? at : p)), closed: e.part.closed },
        !moving,
      );
      moving = true;
      notify();
    },
    endMove() {
      moving = false;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
