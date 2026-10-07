/** breakingChanges(a, b): what a minor version may not contain (docs/05 "Minor versions"). Pure. */
import type { BreakingChange, KeyPath } from './contract';
import { formatKeyPath, isObj, type Obj } from './paths';

/** Sections whose entities hold or address data. `tools` is left out on purpose (A-041): a tool holds no Objekt values, so removing or changing one is never breaking. */
const SECTIONS = ['inputs', 'roles', 'types', 'tasks', 'views'] as const;

/** Entity maps nested inside a section entity, e.g. `types.baum.properties`. */
const NESTED: Readonly<Record<string, readonly string[]>> = {
  types: ['properties', 'relations'],
  tasks: ['form', 'auto'],
  views: ['layers'],
};

/** A path segment appended to a path: `.key` when bare, `["key"]` otherwise. */
const suffix = (key: string): string => formatKeyPath(['x', key]).slice(1);

const entries = (v: unknown): [string, Obj][] =>
  isObj(v) ? Object.entries(v).filter((e): e is [string, Obj] => isObj(e[1])) : [];

export function breakingChanges(a: unknown, b: unknown): BreakingChange[] {
  const out: BreakingChange[] = [];
  const oldFile = isObj(a) ? a : {};
  const newFile = isObj(b) ? b : {};

  /** Compare one entity map; recurse into nested maps and check property types and options. */
  const compareMap = (before: unknown, after: unknown, path: KeyPath, nested: readonly string[]) => {
    const now = isObj(after) ? after : {};
    for (const [key, old] of entries(before)) {
      const at = `${path}${suffix(key)}`;
      const cur = now[key];
      if (!isObj(cur)) {
        out.push({ path: at, kind: 'key_removed', message: `${at} was removed.` });
        continue;
      }
      if (typeof old.type === 'string' && old.type !== cur.type) {
        out.push({ path: at, kind: 'type_changed', message: `${at} changed type from ${old.type}.` });
      }
      // Mehrfachauswahl off: the stored values of a participant or reference property are lists (A-048).
      if (typeof old.type === 'string' && old.cardinality === 'many' && cur.cardinality !== 'many') {
        out.push({ path: at, kind: 'type_changed', message: `${at} changed cardinality from many.` });
      }
      if (old.geometry_type !== cur.geometry_type && (old.geometry_type ?? cur.geometry_type) !== undefined) {
        const was = String(old.geometry_type ?? 'any');
        out.push({ path: at, kind: 'type_changed', message: `${at} changed geometry_type from ${was}.` });
      }
      const oldOptions = isObj(old.options) ? old.options : {};
      const curOptions = isObj(cur.options) ? cur.options : {};
      for (const opt of Object.keys(oldOptions)) {
        if (!(opt in curOptions)) {
          const p = `${at}.options${suffix(opt)}`;
          out.push({ path: p, kind: 'option_removed', message: `The option ${p} was removed.` });
        }
      }
      for (const n of nested) compareMap(old[n], cur[n], `${at}.${n}`, []);
    }
  };

  for (const section of SECTIONS) {
    compareMap(oldFile[section], newFile[section], section, NESTED[section] ?? []);
  }
  return out;
}
