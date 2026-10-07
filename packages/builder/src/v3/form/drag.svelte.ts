/**
 * The drag of the form editor, on pointer events so a mouse, a pen and a finger all work (v3 used HTML5 drag and
 * drop, which has no touch). A drag starts after a few pixels of movement, shows where it would drop (`over`),
 * scrolls the preview near its edges and drops on release; Escape cancels. A press that does not move stays a
 * click: that is how a tile adds a field on a phone. The arrows on a card are the keyboard path to the same edit.
 *
 * Drop targets are elements with `data-dest` (a JSON `Dest`, see `layout.ts`) or `data-squeeze="<key>"` (a single
 * full-width cell: the left half of the element drops to its left, the right half to its right).
 */
import type { Dest } from './layout';

/** What is dragged: a field type of the palette, a property of the library, or a card of the form. */
export type Payload =
  | { readonly kind: 'tile'; readonly tile: string }
  | { readonly kind: 'property'; readonly key: string }
  | { readonly kind: 'card'; readonly key: string };

const THRESHOLD = 4;
const EDGE = 48;
const SPEED = 14;

/** The destination under a point, read from the elements there. */
export function destAt(x: number, y: number): Dest | undefined {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof HTMLElement)) continue;
    const raw = el.dataset['dest'];
    if (raw !== undefined) return JSON.parse(raw) as Dest;
    const key = el.dataset['squeeze'];
    if (key !== undefined) {
      const box = el.getBoundingClientRect();
      return { kind: 'beside', key, column: x < box.left + box.width / 2 ? 'left' : 'right' };
    }
  }
  return undefined;
}

export interface DragOptions {
  readonly onDrop: (payload: Payload, dest: Dest) => void;
  /** The element that scrolls while the pointer is near its edge. */
  readonly scroller: () => HTMLElement | undefined;
}

export function createDrag(options: DragOptions) {
  let active: Payload | undefined = $state();
  let over: Dest | undefined = $state();
  let at = $state({ x: 0, y: 0 });
  let frame = 0;

  function scroll(): void {
    const el = options.scroller();
    if (active === undefined || el === undefined) return;
    const box = el.getBoundingClientRect();
    if (at.y < box.top + EDGE) el.scrollTop -= SPEED;
    else if (at.y > box.bottom - EDGE) el.scrollTop += SPEED;
    over = destAt(at.x, at.y);
    frame = requestAnimationFrame(scroll);
  }

  function stop(): void {
    active = undefined;
    over = undefined;
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
  }

  let pending: { payload: Payload; x: number; y: number } | undefined;

  function move(e: PointerEvent): void {
    at = { x: e.clientX, y: e.clientY };
    if (active === undefined && pending !== undefined) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < THRESHOLD) return;
      active = pending.payload;
      frame = requestAnimationFrame(scroll);
    }
    if (active !== undefined) {
      e.preventDefault();
      over = destAt(e.clientX, e.clientY);
    }
  }

  function up(): void {
    const payload = active;
    const dest = over;
    pending = undefined;
    stop();
    if (payload !== undefined && dest !== undefined) options.onDrop(payload, dest);
    if (payload !== undefined) swallowClick();
  }

  /** A drag that ended on its own source must not also count as the click that adds or selects. */
  function swallowClick(): void {
    const once = (e: Event): void => e.stopPropagation();
    window.addEventListener('click', once, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', once, { capture: true }), 0);
  }

  function cancel(): void {
    pending = undefined;
    stop();
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') cancel();
  }

  return {
    get active() {
      return active;
    },
    get over() {
      return over;
    },
    get at() {
      return at;
    },
    /** `onpointerdown` of a source. A secondary mouse button never starts a drag. */
    begin(e: PointerEvent, payload: Payload): void {
      if (e.button !== 0) return;
      pending = { payload, x: e.clientX, y: e.clientY };
      at = { x: e.clientX, y: e.clientY };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key);
    },
    cancel,
  };
}

export type Drag = ReturnType<typeof createDrag>;
