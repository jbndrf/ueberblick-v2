/**
 * A text edit is a difference between two overlays. The document model only takes ops (WP-200),
 * so the lens turns "before -> typed" into ops; whatever the ops cannot express is caught by the
 * caller, which checks that applying them reproduces the typed overlay exactly.
 */
import type { OverlayFile } from '@ueberblick/core';
import type { Op } from '../../doc';

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

type Entries = Readonly<Record<string, unknown>> | undefined;

/** Ops for one section of key path entries (`inputs`, `override`, `add`). */
function sectionOps(
  before: Entries,
  after: Entries,
  path: (k: string) => string,
  set: (k: string, v: unknown) => Op,
): Op[] {
  const b = before ?? {};
  const a = after ?? {};
  const removed = Object.keys(b)
    .filter((k) => !Object.hasOwn(a, k))
    .map((k): Op => ({ kind: 'reset', path: path(k) }));
  // Shorter paths first: a new entry supersedes entries below it, which are then set again.
  const changed = Object.keys(a)
    .filter((k) => !Object.hasOwn(b, k) || !sameValue(b[k], a[k]))
    .sort((x, y) => x.length - y.length)
    .map((k) => set(k, a[k]));
  return [...removed, ...changed];
}

/** The ops that turn `before` into `after` (`schema` and `extends` are not editable through ops). */
export function overlayOps(before: OverlayFile, after: OverlayFile): Op[] {
  const hidden = (o: OverlayFile): readonly string[] => o.hide ?? [];
  return [
    ...sectionOps(
      before.inputs,
      after.inputs,
      (k) => `inputs.${k}`,
      (k, value) => ({ kind: 'set', path: `inputs.${k}`, value }),
    ),
    ...sectionOps(
      before.override,
      after.override,
      (k) => k,
      (k, value) => ({ kind: 'set', path: k, value }),
    ),
    ...sectionOps(
      before.add,
      after.add,
      (k) => k,
      (k, value) => ({ kind: 'add', path: k, value }),
    ),
    ...hidden(before)
      .filter((k) => !hidden(after).includes(k))
      .map((k): Op => ({ kind: 'unhide', path: k })),
    ...hidden(after)
      .filter((k) => !hidden(before).includes(k))
      .map((k): Op => ({ kind: 'hide', path: k })),
  ];
}
