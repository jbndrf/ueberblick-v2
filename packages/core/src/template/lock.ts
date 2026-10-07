/**
 * The one template-lock matcher (R1). A lock on a path covers that path and everything below it, with one
 * exception (C-004): a project may always add its own automatic action, `tasks.<t>.auto.<name>` for a name the
 * template does not define, even when the template locks `tasks.<t>` or above. The template's own entries stay
 * locked, and a lock on the new entry's own path (or below it) still applies.
 */
import type { TemplateFile } from '../schema';
import type { KeyPath } from './contract';
import { hasAt, parseKeyPath, touches } from './paths';

/** True when `path` is `tasks.<t>.auto.<name>`, a new entry the template does not define. */
function isOwnAutoAdd(template: TemplateFile, path: KeyPath): boolean {
  const parts = parseKeyPath(path);
  return (
    parts !== undefined &&
    parts.length === 4 &&
    parts[0] === 'tasks' &&
    parts[2] === 'auto' &&
    !hasAt(template, path)
  );
}

/**
 * The first template lock that an overlay edit at `path` runs into, or undefined. `adds` is true for an edit that
 * creates a key (`add`, or a `set` on a path the template lacks); only that may use the own-automatic-action exception.
 */
export function lockedBy(template: TemplateFile, path: KeyPath, adds: boolean): KeyPath | undefined {
  const ownAdd = adds && isOwnAutoAdd(template, path);
  const depth = (parseKeyPath(path) ?? []).length;
  return template.lock?.find((l) => touches(l, path) && !(ownAdd && (parseKeyPath(l) ?? []).length < depth));
}
