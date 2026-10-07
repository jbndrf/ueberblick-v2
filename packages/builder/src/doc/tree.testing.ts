/** Tiny helpers for specs that edit parsed YAML by dotted path (no `any`). */
export type Tree = Record<string, unknown>;

const step = (node: unknown, key: string): unknown =>
  node !== null && typeof node === 'object' ? (node as Tree)[key] : undefined;

export const get = (root: unknown, path: string): unknown => path.split('.').reduce(step, root);

const parentOf = (root: unknown, path: string): Tree => {
  const parent = get(root, path.split('.').slice(0, -1).join('.'));
  if (parent === null || typeof parent !== 'object') throw new Error(`no map at ${path}`);
  return parent as Tree;
};

const lastKey = (path: string): string => path.split('.').at(-1) ?? path;

/** Sets the value at `path` (the parent map must exist; the top level may be a new key). */
export function put(root: Tree, path: string, value: unknown): void {
  const parent = path.includes('.') ? parentOf(root, path) : root;
  parent[lastKey(path)] = value;
}

export function drop(root: Tree, path: string): void {
  const parent = path.includes('.') ? parentOf(root, path) : root;
  Reflect.deleteProperty(parent, lastKey(path));
}
