/**
 * The order of a sortable list as pure functions (no DOM, no I/O). v3 moved a dragged workflow next to its drop
 * target (`reference/src/routes/admin/+layout.svelte:79-136`); the sidebar and the column managers all use these.
 */

export const DROP_POSITIONS = ['before', 'after'] as const;
export type DropPosition = (typeof DROP_POSITIONS)[number];

/** Moves `drag` next to `target`; an unknown key or a drop on itself changes nothing. */
export function moveWithin(
  keys: readonly string[],
  drag: string,
  target: string,
  position: DropPosition,
): string[] {
  const from = keys.indexOf(drag);
  const at = keys.indexOf(target);
  if (from < 0 || at < 0 || drag === target) return [...keys];
  const out = keys.filter((k) => k !== drag);
  out.splice(out.indexOf(target) + (position === 'after' ? 1 : 0), 0, drag);
  return out;
}

/** Moves `key` one place up (-1) or down (+1); the same order at either end or for an unknown key. */
export function moveBy(keys: readonly string[], key: string, delta: -1 | 1): string[] {
  const from = keys.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= keys.length) return [...keys];
  const out = [...keys];
  out.splice(from, 1);
  out.splice(to, 0, key);
  return out;
}

/** The half of a box a pointer is over: above the middle is `before`. */
export const positionAt = (clientY: number, top: number, height: number): DropPosition =>
  clientY < top + height / 2 ? 'before' : 'after';

/** True when both lists hold the same keys in the same order. */
export const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((k, i) => k === b[i]);

/** The items in the order of `keys` (a reorder result); items `keys` does not name keep their order after the named ones. */
export function arrange<T>(items: readonly T[], key: (item: T) => string, keys: readonly string[]): T[] {
  const byKey = new Map(items.map((it) => [key(it), it]));
  const named = new Set(keys);
  return [...keys.flatMap((k) => byKey.get(k) ?? []), ...items.filter((it) => !named.has(key(it)))];
}
