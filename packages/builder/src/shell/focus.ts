/**
 * Focusing the entity and field a key path points at. Lenses mark what they draw with
 * `data-path="<key path>"`; the shell focuses the deepest marked element whose path is the problem's
 * path or a prefix of it, so it works for any lens without the shell knowing it.
 */
import { parseKeyPath, type KeyPath } from '@ueberblick/core';

/** Number of leading segments `a` shares with `b`, when `a` is a prefix of `b` (else -1). */
function prefixDepth(a: KeyPath, b: KeyPath): number {
  const sa = parseKeyPath(a);
  const sb = parseKeyPath(b);
  if (sa === undefined || sb === undefined || sa.length > sb.length) return -1;
  return sa.every((s, i) => s === sb[i]) ? sa.length : -1;
}

/** The element to focus for `path` inside `root`, or null when nothing on screen matches. */
export function findPathTarget(root: ParentNode, path: KeyPath): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDepth = 0;
  for (const el of root.querySelectorAll<HTMLElement>('[data-path]')) {
    const depth = prefixDepth(el.dataset['path'] ?? '', path);
    if (depth > bestDepth) {
      best = el;
      bestDepth = depth;
    }
  }
  return best;
}

/** Focuses the target for `path` (making it focusable when it is not), or `fallback`. Returns what got focus. */
export function focusPath(root: ParentNode, path: KeyPath, fallback: HTMLElement | null): HTMLElement | null {
  const target = findPathTarget(root, path) ?? fallback;
  if (target === null) return null;
  if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) target.tabIndex = -1;
  target.focus();
  return target;
}
