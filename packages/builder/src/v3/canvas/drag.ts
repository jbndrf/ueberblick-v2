/**
 * The drags of the canvas on pointer events, so a mouse, a pen and a finger all work (v3 used HTML5 drag and drop,
 * `TaskToolbarList.svelte:93-111`, which has no touch; the form editor's drag, `form/drag.svelte.ts`, made the same
 * switch). A press that does not move stays a click. A drag starts after a few pixels, marks the button under the
 * pointer (`data-drop`) and drops on release; Escape cancels. Targets are elements with `data-task-id` (or the
 * "Button hinzufügen" row, `data-add-task`) that carry `data-scope` (a phase key, or empty for the global container).
 */
import type { ToolKind } from './model';

export type DragPayload =
  /** The grip of a button: reorder it within its scope. */
  | { readonly kind: 'reorder'; readonly task: string; readonly scope: string }
  /** A tool icon: move (copy with Alt) it to another button. */
  | { readonly kind: 'tool'; readonly task: string; readonly index: number; readonly tool: ToolKind };

export interface DragTarget {
  /** The button under the pointer; empty on the "Button hinzufügen" row, which stands for the end of the scope. */
  readonly task: string;
  readonly scope: string;
  readonly el: HTMLElement;
}

export interface DragHandlers {
  /** The pointer is released over `target` (undefined: not over a button). `copy`: Alt, Ctrl or Meta was held. */
  readonly onDrop: (payload: DragPayload, target: DragTarget | undefined, copy: boolean) => void;
  /** Where the elements under the pointer are read from (tests replace it: jsdom has no layout). */
  readonly hit?: (x: number, y: number) => readonly Element[];
}

const THRESHOLD = 4;

/** The button under a point, read from the elements there. */
export function targetAt(hit: readonly Element[]): DragTarget | undefined {
  for (const el of hit) {
    if (!(el instanceof HTMLElement)) continue;
    const task = el.dataset['taskId'];
    const scope = el.dataset['scope'];
    if (task !== undefined && scope !== undefined) return { task, scope, el };
    if (el.dataset['addTask'] !== undefined && scope !== undefined) return { task: '', scope, el };
  }
  return undefined;
}

/** Starts watching the pointer of `event` (a `pointerdown` on a grip or a tool icon). */
export function startDrag(event: PointerEvent, payload: DragPayload, handlers: DragHandlers): void {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  const origin = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  const hit = handlers.hit ?? ((x, y) => document.elementsFromPoint(x, y));
  let moved = false;
  let over: DragTarget | undefined;

  const mark = (next: DragTarget | undefined): void => {
    if (over?.el === next?.el) return;
    over?.el.removeAttribute('data-drop');
    next?.el.setAttribute('data-drop', '');
    over = next;
  };
  const move = (e: PointerEvent): void => {
    if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
    moved = true;
    origin.setAttribute('data-dragging', '');
    mark(targetAt(hit(e.clientX, e.clientY)));
  };
  const stop = (): void => {
    origin.removeEventListener('pointermove', move);
    origin.removeEventListener('pointerup', up);
    origin.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', esc, true);
    origin.removeAttribute('data-dragging');
    mark(undefined);
    if (origin.hasPointerCapture?.(event.pointerId)) origin.releasePointerCapture(event.pointerId);
  };
  const up = (e: PointerEvent): void => {
    const target = moved ? targetAt(hit(e.clientX, e.clientY)) : undefined;
    const copy = e.altKey || e.ctrlKey || e.metaKey;
    stop();
    // A press that never moved is a click: the element's own click handler runs; a drag swallows it once.
    if (moved) {
      const swallow = (c: Event): void => c.stopPropagation();
      origin.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => origin.removeEventListener('click', swallow, { capture: true }), 0);
      handlers.onDrop(payload, target, copy);
    }
  };
  const cancel = (): void => stop();
  const esc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') stop();
  };

  origin.setPointerCapture?.(event.pointerId);
  origin.addEventListener('pointermove', move);
  origin.addEventListener('pointerup', up);
  origin.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', esc, true);
}
