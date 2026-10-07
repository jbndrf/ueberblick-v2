/** Overlay `order`: listed keys first, in the given order; the rest keep their relative order. Pure. */
import { ORDERED_MAPS } from '../registry/compile';
import { formatKeyPath, isObj, type Obj } from './paths';

export function reorderKeys(map: Obj, list: readonly string[]): Obj {
  const first = [...new Set(list)].filter((k) => Object.hasOwn(map, k));
  const rest = Object.keys(map).filter((k) => !first.includes(k));
  const out: Obj = {};
  for (const k of [...first, ...rest]) out[k] = map[k];
  return out;
}

/** The ordered maps of a file (`ORDERED_MAPS`): key path to the keys in their order. */
export function orderedMaps(file: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const pattern of ORDERED_MAPS.keys) {
    const walk = (node: unknown, rest: readonly string[], at: readonly string[]): void => {
      if (!isObj(node)) return;
      const [head, ...tail] = rest;
      if (head === undefined) {
        out.set(formatKeyPath(at), Object.keys(node));
        return;
      }
      for (const k of head === '*' ? Object.keys(node) : [head]) walk(node[k], tail, [...at, k]);
    };
    walk(file, pattern.split('.'), []);
  }
  return out;
}

/** What a file's key order contributes to its identity: the key lists of its ordered maps, canonical and stable. */
export function orderSignature(file: unknown): Record<string, string[]> {
  return Object.fromEntries([...orderedMaps(file)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The ordered maps present in both files whose shared keys are in another order, as key path, keys before, keys after. */
export function reorderedMaps(a: unknown, b: unknown): { path: string; before: string[]; after: string[] }[] {
  const mb = orderedMaps(b);
  const out: { path: string; before: string[]; after: string[] }[] = [];
  for (const [path, ka] of orderedMaps(a)) {
    const kb = mb.get(path);
    if (kb === undefined) continue;
    const inB = new Set(kb);
    const inA = new Set(ka);
    const before = ka.filter((k) => inB.has(k));
    const after = kb.filter((k) => inA.has(k));
    if (before.some((k, i) => k !== after[i])) out.push({ path, before, after });
  }
  return out;
}
