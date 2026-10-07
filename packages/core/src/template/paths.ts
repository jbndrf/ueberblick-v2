/**
 * Pure helpers for key paths into plain JSON-like objects (no I/O).
 * Grammar (the ONE key-path implementation, R1): segments joined by `.`; a segment that matches
 * `^[a-z][a-z0-9_]*$` is written bare, any other segment as a bracketed JSON string, appended
 * without a dot: `style["circle-color"]`, `label["en-GB"].x`, `["a.b"]`. Lists are atomic:
 * a path never descends into an array.
 */
import type { KeyPath } from './contract';

export type Obj = { [key: string]: unknown };

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const BARE = /^[a-z][a-z0-9_]*$/;

/** Format segments as a key path. Inverse of `parseKeyPath`. */
export function formatKeyPath(segments: readonly string[]): KeyPath {
  let out = '';
  for (const s of segments) {
    if (BARE.test(s)) out += out === '' ? s : `.${s}`;
    else out += `[${JSON.stringify(s)}]`;
  }
  return out;
}

/** Parse a key path into segments, or `undefined` when it is not valid. */
export function parseKeyPath(path: KeyPath): string[] | undefined {
  const out: string[] = [];
  const n = path.length;
  let i = 0;
  while (i < n) {
    let afterDot = false;
    if (out.length > 0 && path[i] === '.') {
      afterDot = true;
      i += 1;
    } else if (out.length > 0 && path[i] !== '[') return undefined;
    if (path[i] === '[' && !afterDot) {
      if (path[i + 1] !== '"') return undefined;
      let j = i + 2;
      while (j < n && path[j] !== '"') j += path[j] === '\\' ? 2 : 1;
      if (j >= n || path[j + 1] !== ']') return undefined;
      let seg: unknown;
      try {
        seg = JSON.parse(path.slice(i + 1, j + 1));
      } catch {
        return undefined;
      }
      if (typeof seg !== 'string') return undefined;
      out.push(seg);
      i = j + 2;
    } else {
      let j = i;
      while (j < n && path[j] !== '.' && path[j] !== '[') j += 1;
      const seg = path.slice(i, j);
      if (!BARE.test(seg)) return undefined;
      out.push(seg);
      i = j;
    }
  }
  return out.length > 0 ? out : undefined;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

export function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (isObj(v)) {
    const out: Obj = {};
    for (const k of Object.keys(v)) out[k] = clone(v[k]);
    return out as T;
  }
  return v;
}

/** The value at `path`, or `undefined` when any segment is missing or the path is invalid. */
export function getAt(root: unknown, path: KeyPath): unknown {
  let cur: unknown = root;
  const parts = parseKeyPath(path);
  if (!parts) return undefined;
  for (const s of parts) {
    if (!isObj(cur) || !Object.hasOwn(cur, s)) return undefined;
    cur = cur[s];
  }
  return cur;
}

export const hasAt = (root: unknown, path: KeyPath): boolean => getAt(root, path) !== undefined;

/** The object that holds the last segment of `path`, when it exists. */
function parentOf(root: unknown, path: KeyPath): { parent: Obj; key: string } | undefined {
  const parts = parseKeyPath(path);
  if (!parts) return undefined;
  const key = parts[parts.length - 1] as string;
  const parent = parts.length === 1 ? root : getAt(root, formatKeyPath(parts.slice(0, -1)));
  return isObj(parent) ? { parent, key } : undefined;
}

/** Set the value at `path`; the parent must exist. Returns false when it does not. */
export function setAt(root: Obj, path: KeyPath, value: unknown): boolean {
  const at = parentOf(root, path);
  if (!at) return false;
  at.parent[at.key] = value;
  return true;
}

export function deleteAt(root: Obj, path: KeyPath): boolean {
  const at = parentOf(root, path);
  if (!at || !Object.hasOwn(at.parent, at.key)) return false;
  return Reflect.deleteProperty(at.parent, at.key);
}

/** True when one path equals, contains or lies inside the other (compared by segment). */
export function touches(a: KeyPath, b: KeyPath): boolean {
  const pa = parseKeyPath(a);
  const pb = parseKeyPath(b);
  if (!pa || !pb) return false;
  const n = Math.min(pa.length, pb.length);
  return pa.slice(0, n).every((s, i) => s === pb[i]);
}

/** The path of the parent, or `undefined` for a top-level path or an invalid one. */
export function parentPath(path: KeyPath): KeyPath | undefined {
  const parts = parseKeyPath(path);
  return parts && parts.length > 1 ? formatKeyPath(parts.slice(0, -1)) : undefined;
}

/**
 * Minimal key paths at which `a` and `b` differ. Objects recurse; arrays, scalars and objects under
 * the paths `isAtomic` accepts are leaves.
 */
export function diffPaths(
  a: unknown,
  b: unknown,
  isAtomic: (path: readonly string[]) => boolean = () => false,
  prefix: readonly string[] = [],
): KeyPath[] {
  if (deepEqual(a, b)) return [];
  if (!isObj(a) || !isObj(b) || (prefix.length > 0 && isAtomic(prefix)))
    return prefix.length === 0 ? [] : [formatKeyPath(prefix)];
  const out: KeyPath[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const path = [...prefix, k];
    if (!(k in a) || !(k in b)) out.push(formatKeyPath(path));
    else out.push(...diffPaths(a[k], b[k], isAtomic, path));
  }
  return out;
}
