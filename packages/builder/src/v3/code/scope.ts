import { splitAutoId } from '@ueberblick/core';
import type { Doc, TypeScope } from '../../doc';
import { buildInventory } from '../catalog/inventory';

/**
 * What the Code view of one Objektart shows (v3: the whole workflow): the type and the tasks offered on it with
 * their automatic actions, the same lists as the catalog's (`buildInventory`). `undefined` when the draft has no such
 * type.
 */
export function scopeOf(doc: Doc, type: string, locale: string): TypeScope | undefined {
  if (doc.effective().types?.[type] === undefined) return undefined;
  const inv = buildInventory(doc, type, locale);
  const keys = new Set([...inv.tasks.map((t) => t.key), ...inv.rules.map((r) => splitAutoId(r.key).task)]);
  return { type, tasks: Object.keys(doc.effective().tasks ?? {}).filter((k) => keys.has(k)) };
}
