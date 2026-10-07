// Can this thread write OPFS files with `createWritable`? Safari's main thread cannot (only a worker, through a
// sync access handle), so there the writes go to the pack writer worker (WP-650).
export interface FsGlobals {
  readonly FileSystemFileHandle?: { readonly prototype: object };
}

export function mainThreadCanWrite(g: FsGlobals): boolean {
  const handle = g.FileSystemFileHandle;
  return handle === undefined || 'createWritable' in handle.prototype;
}
