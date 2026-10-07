/** Which entity a key path points into, as a selection (a problem entry selects it). */
import { parseKeyPath, type KeyPath } from '@ueberblick/core';
import type { Selection } from './registry';

export function selectionForPath(type: string, path: KeyPath): Selection {
  const seg = parseKeyPath(path) ?? [];
  const [area, key, sub, leaf] = seg;
  if (area === 'tasks' && key !== undefined) return { kind: 'task', id: key };
  if (area === 'rules' && key !== undefined) return { kind: 'rule', id: key };
  if (area === 'types' && key === type) {
    if (sub === 'properties' && leaf !== undefined) return { kind: 'field', id: leaf };
    return { kind: 'type', id: key };
  }
  return { kind: 'none' };
}
