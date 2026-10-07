/**
 * `diff(a, b)`: what changed between two effective files, addressed by key path (A-005 grammar,
 * built with `formatKeyPath`). An entity that is new or gone is one entry at its own path; a changed
 * value is one entry at the path of the value. Lists are atomic: a changed list is one entry.
 * An ordered map (`ORDERED_MAPS`) whose shared keys changed order is one `order_changed` entry at the
 * map, never breaking (A-042): the order is served config. Which entries are `breaking` is decided by `template.breakingChanges`, the one rule (R1).
 */
import { breakingChanges } from '../../template/breaking';
import { reorderedMaps } from '../../template/order';
import { formatKeyPath, parentPath, parseKeyPath } from '../../template/paths';
import type { TemplateFile } from '../file';
import type { DiffEntry } from './contract';
import { canonicalJson } from './hash';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The paths `breakingChanges` reports, split by what happened there. */
interface Breaking {
  readonly removed: ReadonlySet<string>;
  readonly typeChanged: ReadonlySet<string>;
}

function breakingPaths(a: TemplateFile, b: TemplateFile): Breaking {
  const removed = new Set<string>();
  const typeChanged = new Set<string>();
  for (const c of breakingChanges(a, b)) (c.kind === 'type_changed' ? typeChanged : removed).add(c.path);
  return { removed, typeChanged };
}

function isBreaking(path: string, change: DiffEntry['change'], br: Breaking): boolean {
  if (change === 'removed' && br.removed.has(path)) return true;
  const segments = parseKeyPath(path);
  const last = segments?.[segments.length - 1];
  const parent = parentPath(path);
  // `type`, `geometry_type` and `cardinality` are the keys whose change `breakingChanges` reports as type_changed.
  return (
    (last === 'type' || last === 'geometry_type' || last === 'cardinality') &&
    parent !== undefined &&
    br.typeChanged.has(parent)
  );
}

function walk(prefix: readonly string[], a: unknown, b: unknown, br: Breaking, out: DiffEntry[]): void {
  if (isObject(a) && isObject(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const segments = [...prefix, k];
      const p = formatKeyPath(segments);
      const inA = a[k] !== undefined;
      const inB = b[k] !== undefined;
      if (inA && !inB) {
        out.push({ path: p, change: 'removed', breaking: isBreaking(p, 'removed', br), before: a[k] });
      } else if (!inA && inB) out.push({ path: p, change: 'added', breaking: false, after: b[k] });
      else if (inA && inB) walk(segments, a[k], b[k], br, out);
    }
    return;
  }
  if (canonicalJson(a) === canonicalJson(b)) return;
  const path = formatKeyPath(prefix);
  out.push({ path, change: 'changed', breaking: isBreaking(path, 'changed', br), before: a, after: b });
}

export function diff(a: TemplateFile, b: TemplateFile): readonly DiffEntry[] {
  const out: DiffEntry[] = [];
  walk([], a, b, breakingPaths(a, b), out);
  for (const r of reorderedMaps(a, b)) {
    out.push({ path: r.path, change: 'order_changed', breaking: false, before: r.before, after: r.after });
  }
  return out;
}
