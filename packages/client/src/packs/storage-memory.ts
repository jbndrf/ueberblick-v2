// An in-memory PackStorage: the fake the specs and the bench use.
import type { PackStorage, PackWriter } from './contract';

export interface MemoryPackStorage extends PackStorage {
  /** The files by path (tests peek at it and plant files). */
  readonly files: Map<string, Uint8Array>;
  readonly texts: Map<string, string>;
}

export function memoryPackStorage(options: { supported?: boolean } = {}): MemoryPackStorage {
  const files = new Map<string, Uint8Array>();
  const texts = new Map<string, string>();
  return {
    supported: options.supported ?? true,
    files,
    texts,
    size: async (path) => files.get(path)?.length,
    async open(path, at): Promise<PackWriter> {
      const parts: Uint8Array[] = [(files.get(path) ?? new Uint8Array()).slice(0, at)];
      const flush = (): void => {
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) {
          out.set(p, o);
          o += p.length;
        }
        parts.splice(0, parts.length, out);
        files.set(path, out);
      };
      flush();
      return {
        write: async (chunk) => {
          parts.push(chunk.slice());
        },
        close: async () => flush(),
      };
    },
    read: async (path, offset, length) => {
      const f = files.get(path);
      if (f === undefined) throw new Error(`no such file: ${path}`);
      return f.slice(offset, offset + length);
    },
    blob: async (path) => {
      const f = files.get(path);
      return f === undefined ? undefined : new Blob([new Uint8Array(f)]);
    },
    remove: async (path) => {
      files.delete(path);
    },
    list: async () => [...files.keys()],
    readText: async (path) => texts.get(path),
    writeText: async (path, text) => {
      texts.set(path, text);
    },
  };
}
