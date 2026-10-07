import { moveBy, moveWithin, positionAt, sameOrder, type DropPosition } from './reorder.js';

/** A new order and the key that moved to get it. */
export interface Reorder {
  readonly keys: string[];
  readonly moved: string;
}

/**
 * The drag state of one sortable list (v3 `dragKey`, `dropKey`, `dropPos`, `+layout.svelte:79-136`). The items
 * read it to draw the drop line; the list owner reacts to the `Reorder` an item reports.
 */
export class SortableState {
  dragKey = $state<string | null>(null);
  dropKey = $state<string | null>(null);
  dropPos = $state<DropPosition | null>(null);
  /** The key whose handle takes focus once it has moved (a keyboard move re-renders the list). */
  focusKey = $state<string | null>(null);

  start(e: DragEvent, key: string): void {
    this.dragKey = key;
    this.focusKey = null;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
    }
  }

  over(e: DragEvent, over: string): void {
    if (!this.dragKey || this.dragKey === over) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.dropKey = over;
    this.dropPos = positionAt(e.clientY, rect.top, rect.height);
  }

  leave(over: string): void {
    if (this.dropKey === over) {
      this.dropKey = null;
      this.dropPos = null;
    }
  }

  end(): void {
    this.dragKey = this.dropKey = this.dropPos = null;
  }

  /** The new order after a drop, or null when nothing changes. */
  drop(e: DragEvent, keys: readonly string[]): Reorder | null {
    e.preventDefault();
    const [drag, target, pos] = [this.dragKey, this.dropKey, this.dropPos];
    this.end();
    if (!drag || !target || !pos || drag === target) return null;
    const next = moveWithin(keys, drag, target, pos);
    return sameOrder(next, keys) ? null : { keys: next, moved: drag };
  }

  /** The new order after moving `key` one place, or null at either end; the key keeps focus. */
  step(keys: readonly string[], key: string, delta: -1 | 1): Reorder | null {
    const next = moveBy(keys, key, delta);
    if (sameOrder(next, keys)) return null;
    this.focusKey = key;
    return { keys: next, moved: key };
  }
}
