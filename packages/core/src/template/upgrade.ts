/**
 * upgrade(old, overlay, new): key-wise three-way merge (docs/05 "Upgrade semantics").
 *
 * Per overlay entry, comparing the old and the new template at the entry's path:
 * - template unchanged there: the overlay entry is kept (row 2);
 * - both changed, to different values: conflict, the overlay value is kept (row 3);
 * - both changed to the same value: the entry is redundant and dropped;
 * - the new template removed the path: unresolved unless a shipped migration names it (row 4).
 * Template changes no overlay entry touches apply on their own (row 1, `autoApplied`).
 * An `order` entry keeps its listed keys that the new template did not remove; keys the new template adds follow them.
 * Input values are the intended customisation point: the overlay value wins over a changed default.
 */
import type { OverlayFile, TemplateFile } from '../schema';
import type { KeyPath, UpgradeConflict, UpgradeResult } from './contract';
import {
  deepEqual,
  diffPaths,
  formatKeyPath,
  getAt,
  hasAt,
  isObj,
  parentPath,
  parseKeyPath,
  touches,
} from './paths';

/** Values under these keys change as a unit: localized strings and option maps. */
const ATOMIC_KEYS = ['label', 'description', 'constraint_message', 'options'];
/** Maps whose keys are entity keys; a property may be called `label` without being atomic. */
const ENTITY_MAPS = [
  'inputs',
  'roles',
  'types',
  'tasks',
  'auto',
  'views',
  'tools',
  'properties',
  'relations',
  'form',
  'layers',
];
const isAtomic = (path: readonly string[]): boolean =>
  ATOMIC_KEYS.includes(path[path.length - 1] ?? '') && !ENTITY_MAPS.includes(path[path.length - 2] ?? '');

/** Top-level keys that describe the template itself, not its config. */
const TEMPLATE_LEVEL = ['template', 'migrations'];

const major = (version: string): number => Number.parseInt(version.split('.')[0] ?? '0', 10);

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (isObj(v)) for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** True when a migration shipped for this major step names the path or one of its ancestors/descendants. */
function migrated(oldT: TemplateFile, newT: TemplateFile, path: KeyPath): boolean {
  const steps = newT.migrations?.[`${major(oldT.template.version)} -> ${major(newT.template.version)}`];
  return steps !== undefined && strings(steps).some((s) => touches(s, path));
}

export function upgrade(oldT: TemplateFile, overlay: OverlayFile, newT: TemplateFile): UpgradeResult {
  const conflicts: UpgradeConflict[] = [];
  const unresolved: KeyPath[] = [];
  const touched: KeyPath[] = [];
  const unresolve = (path: KeyPath) => {
    if (!migrated(oldT, newT, path)) unresolved.push(path);
  };

  /** Decide one value entry (override or add). Returns true to keep it. */
  const keepValue = (path: KeyPath, ours: unknown, isAdd: boolean): boolean => {
    touched.push(path);
    const base = getAt(oldT, path);
    const theirs = getAt(newT, path);
    if (theirs === undefined) {
      const parent = parentPath(path) ?? '';
      const removed = isAdd
        ? parent !== '' && hasAt(oldT, parent) && !hasAt(newT, parent)
        : base !== undefined;
      if (removed) unresolve(path);
      return true;
    }
    if (deepEqual(base, theirs)) return true;
    if (deepEqual(ours, theirs)) return false;
    conflicts.push({ path, base, theirs, ours });
    return true;
  };

  const override = Object.fromEntries(
    Object.entries(overlay.override ?? {}).filter(([p, v]) => keepValue(p, v, false)),
  );
  const add = Object.fromEntries(Object.entries(overlay.add ?? {}).filter(([p, v]) => keepValue(p, v, true)));
  const hide = (overlay.hide ?? []).filter((p) => {
    touched.push(p);
    return !(hasAt(oldT, p) && !hasAt(newT, p));
  });
  const order = Object.fromEntries(
    Object.entries(overlay.order ?? {}).flatMap(([path, list]) => {
      if (hasAt(oldT, path) && !hasAt(newT, path)) return [];
      const kept = list.filter((k) => {
        const key = formatKeyPath([...(parseKeyPath(path) ?? []), k]);
        return !(hasAt(oldT, key) && !hasAt(newT, key));
      });
      return kept.length > 0 ? [[path, kept] as const] : [];
    }),
  );
  const inputs = overlay.inputs ?? {};
  for (const key of Object.keys(inputs)) {
    touched.push(`inputs.${key}`);
    if (hasAt(oldT, `inputs.${key}`) && !hasAt(newT, `inputs.${key}`)) unresolve(`inputs.${key}`);
  }

  const autoApplied = diffPaths(oldT, newT, isAtomic).filter(
    (d) => !TEMPLATE_LEVEL.includes(parseKeyPath(d)?.[0] ?? '') && !touched.some((t) => touches(t, d)),
  );

  const [name] = overlay.extends.split('@');
  const range =
    major(overlay.extends.split('@')[1] ?? '0') === major(newT.template.version)
      ? overlay.extends
      : `${name}@${major(newT.template.version)}`;
  const next: OverlayFile = {
    schema: overlay.schema,
    extends: range,
    ...(overlay.inputs ? { inputs: overlay.inputs } : {}),
    ...(Object.keys(override).length > 0 ? { override } : {}),
    ...(Object.keys(add).length > 0 ? { add } : {}),
    ...(hide.length > 0 ? { hide } : {}),
    ...(Object.keys(order).length > 0 ? { order } : {}),
  };
  return { overlay: next, conflicts, autoApplied, unresolved };
}
