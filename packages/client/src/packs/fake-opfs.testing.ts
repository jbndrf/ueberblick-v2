// A real directory tree behind the OPFS handle interface, so specs can share one "origin private file system"
// between several scoped stores. Tests only.
import type { DirEntry, DirHandle, FileHandle } from './storage-opfs';

interface Node {
  readonly dirs: Map<string, Node>;
  readonly files: Map<string, Uint8Array>;
}
export const newTree = (): Node => ({ dirs: new Map(), files: new Map() });
const missing = (): Error => Object.assign(new Error('not found'), { name: 'NotFoundError' });

function fileHandle(node: Node, name: string): FileHandle {
  return {
    getFile: async () => {
      const b = node.files.get(name) ?? new Uint8Array();
      return {
        size: b.length,
        text: async () => new TextDecoder().decode(b),
        slice: (a: number, z: number) => new Blob([b.slice(a, z)]),
      };
    },
    createWritable: async (o) => {
      let cur = o?.keepExistingData === true ? (node.files.get(name) ?? new Uint8Array()) : new Uint8Array();
      let at = 0;
      node.files.set(name, cur);
      return {
        truncate: async (n) => {
          cur = cur.slice(0, n);
          node.files.set(name, cur);
        },
        seek: async (n) => {
          at = n;
        },
        write: async (data) => {
          const next = new Uint8Array(Math.max(cur.length, at + data.length));
          next.set(cur);
          next.set(data, at);
          at += data.length;
          cur = next;
          node.files.set(name, cur);
        },
        close: async () => undefined,
      };
    },
  };
}

export function dirHandle(node: Node): DirHandle {
  return {
    async getDirectoryHandle(name, o) {
      let d = node.dirs.get(name);
      if (d === undefined) {
        if (o?.create !== true) throw missing();
        d = newTree();
        node.dirs.set(name, d);
      }
      return dirHandle(d);
    },
    async getFileHandle(name, o) {
      if (!node.files.has(name)) {
        if (o?.create !== true) throw missing();
        node.files.set(name, new Uint8Array());
      }
      return fileHandle(node, name);
    },
    async removeEntry(name) {
      if (!node.files.delete(name) && !node.dirs.delete(name)) throw missing();
    },
    async *entries(): AsyncIterable<[string, DirEntry]> {
      for (const [n, d] of node.dirs) yield [n, { ...dirHandle(d), kind: 'directory' }];
      for (const n of node.files.keys()) yield [n, { ...fileHandle(node, n), kind: 'file' }];
    },
  };
}
