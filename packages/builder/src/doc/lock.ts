/**
 * The one template-lock matcher (R1): merge refuses an overlay entry that touches a path of the template's
 * `lock`, so a path is locked when it is under a lock or contains one. Used by `checkOps`, the provenance marks
 * and the catalog's locked creates.
 */
import { lockedBy, type KeyPath } from '@ueberblick/core';
import type { Doc, Op } from './contract';

/**
 * The first template lock that an edit at `path` runs into; undefined when the path is free. An op that creates
 * a key (`add`, `set` on a key the template lacks) may add the project's own automatic action under a locked task.
 */
export function lockOf(doc: Doc, path: KeyPath, kind?: Op['kind']): KeyPath | undefined {
  return lockedBy(doc.template, path, kind === 'add' || kind === 'set');
}
