// An in-memory ThumbCache: the fake of the specs. Tests only.
import type { ThumbCache } from './contract';

export function memoryThumbCache(supported = true): ThumbCache & { readonly rows: Map<string, Uint8Array> } {
  const rows = new Map<string, Uint8Array>();
  const mimes = new Map<string, string>();
  return {
    supported,
    rows,
    get: async (sha) => {
      const b = rows.get(sha);
      return b === undefined ? undefined : new Blob([b.slice()], { type: mimes.get(sha) ?? '' });
    },
    has: async (sha) => rows.has(sha),
    put: async (sha, bytes, mime) => {
      if (!supported) return;
      rows.set(sha, bytes.slice());
      mimes.set(sha, mime);
    },
    count: async () => rows.size,
    bytes: async () => [...rows.values()].reduce((n, b) => n + b.length, 0),
    keys: async () => [...rows.keys()],
    remove: async (sha) => void rows.delete(sha),
    clear: async () => rows.clear(),
  };
}
