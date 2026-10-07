/** merge(template, overlay): the effective config (docs/05 "A customer project"). Pure. */
import type { Provenance } from '../registry/admin';
import type { OverlayFile, TemplateFile } from '../schema';
import type { ProblemParams } from '../schema/compile/contract';
import type { KeyPath, MergeIssue, MergeResult } from './contract';
import {
  clone,
  formatKeyPath,
  getAt,
  hasAt,
  isObj,
  setAt,
  deleteAt,
  parentPath,
  parseKeyPath,
  touches,
  type Obj,
} from './paths';
import { lockedBy } from './lock';
import { reorderKeys } from './order';
import { collectReferences } from './references';

/** Sections whose entities an overlay may add to even when the template has none yet. */
const SECTIONS = ['roles', 'types', 'tasks', 'views', 'tools', 'map', 'info_pages', 'branding'];

export function merge(template: TemplateFile, overlay: OverlayFile): MergeResult {
  const file = clone(template) as Obj;
  const provenance = new Map<KeyPath, Provenance>();
  const issues: MergeIssue[] = [];
  const problem = (code: MergeIssue['code'], path: KeyPath, message: string, params: ProblemParams = {}) =>
    issues.push({ path, code, message, params: { path, ...params } });
  const locked = (path: KeyPath, adds = false): boolean => {
    const lock = lockedBy(template, path, adds);
    if (lock === undefined) return false;
    problem('lock_violation', path, `The template locks ${lock}; the overlay may not touch ${path}.`, {
      lock,
    });
    return true;
  };

  for (const [key, value] of Object.entries(overlay.inputs ?? {})) {
    const path = `inputs.${key}`;
    if (!isObj(file.inputs) || !hasAt(file, path)) {
      problem('unknown_path', path, `The template has no input ${key}.`, { variant: 'input', key });
    } else if (!locked(path)) {
      setAt(file, `${path}.default`, value);
      provenance.set(`${path}.default`, 'changed');
    }
  }

  for (const [path, value] of Object.entries(overlay.override ?? {})) {
    if (locked(path)) continue;
    if (!hasAt(file, path)) problem('unknown_path', path, `The template has no ${path} to override.`);
    else {
      setAt(file, path, clone(value));
      provenance.set(path, 'changed');
    }
  }

  for (const [path, value] of Object.entries(overlay.add ?? {})) {
    if (locked(path, true)) continue;
    const parts = parseKeyPath(path);
    if (!parts) {
      problem('unknown_path', path, `${path} is not a valid key path.`, { variant: 'invalid_path' });
      continue;
    }
    if (parts.length === 1) {
      // A whole new top-level section is not something an overlay may add.
      problem('unknown_path', path, `${path} is not an entity path.`, { variant: 'not_entity' });
      continue;
    }
    const parent = parentPath(path) ?? '';
    // The `map` section is one object (`start`, `layers`), so a new one starts with its layer list (docs/05).
    if (parts[0] === 'map' && !hasAt(file, 'map')) file['map'] = { layers: {} };
    if (parts.length === 2 && SECTIONS.includes(parent) && !hasAt(file, parent)) file[parent] = {};
    // A task's first automatic action creates its `auto` map: the project adds `tasks.<t>.auto.<name>` (C-004).
    if (parts.length === 4 && parts[0] === 'tasks' && parts[2] === 'auto' && hasAt(file, `tasks.${parts[1]}`))
      if (!hasAt(file, parent)) setAt(file, parent, {});
    if (hasAt(file, path)) problem('path_exists', path, `The template already has ${path}; use override.`);
    else if (!setAt(file, path, clone(value)))
      problem('unknown_path', path, `The template has no ${parent} to add to.`, {
        variant: 'add_parent',
        parent,
      });
    else provenance.set(path, 'added');
  }

  const hidden: KeyPath[] = [];
  for (const path of overlay.hide ?? []) {
    if (locked(path)) continue;
    if (deleteAt(file, path)) hidden.push(path);
    else problem('unknown_path', path, `The template has no ${path} to hide.`, { variant: 'hide' });
  }

  if (hidden.length > 0) {
    const refs = collectReferences(file);
    for (const h of hidden) {
      for (const from of new Set(refs.get(h) ?? [])) {
        problem('hidden_referenced', from, `${from} refers to ${h}, which the overlay hides.`, {
          hidden: h,
        });
      }
    }
  }

  for (const [path, list] of Object.entries(overlay.order ?? {})) {
    // Reordering a map leaves its entries alone: only a lock on the map itself or above it applies.
    const lock = template.lock?.find(
      (l) => touches(l, path) && (parseKeyPath(l)?.length ?? 0) <= (parseKeyPath(path)?.length ?? 0),
    );
    if (lock !== undefined) {
      problem('lock_violation', path, `The template locks ${lock}; the overlay may not order ${path}.`, {
        variant: 'order',
        lock,
      });
      continue;
    }
    const map = getAt(file, path);
    if (!isObj(map)) {
      problem('unknown_path', path, `The effective config has no map at ${path} to order.`, {
        variant: 'order_map',
      });
      continue;
    }
    for (const k of list) {
      if (!Object.hasOwn(map, k))
        problem(
          'unknown_path',
          formatKeyPath([...(parseKeyPath(path) ?? []), k]),
          `${path} has no key ${k} to order.`,
          { variant: 'order_key', key: k },
        );
    }
    if (setAt(file, path, reorderKeys(map, list))) provenance.set(path, 'changed');
  }

  return { file: file as unknown as TemplateFile, provenance, issues };
}
