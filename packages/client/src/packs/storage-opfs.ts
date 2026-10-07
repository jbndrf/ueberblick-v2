// The OPFS PackStorage (docs/03: packs live in the origin private file system). A browser without OPFS gets
// `supported: false`, and the map keeps using the network.
import type { PackStorage, PackWriter } from './contract';
import {
  isNotFound,
  opfsDirOf,
  opfsFileOf,
  scopeDirs,
  scopedRoot,
  splitPath,
  type PackScope,
} from './opfs-paths';

export type { PackScope };
import type { PackFileWriter } from './writer-protocol';

/** The slice of the File System API this store uses (OPFS handles). */
export interface DirHandle {
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, DirEntry]>;
}
export interface FileHandle {
  getFile(): Promise<{ readonly size: number; text(): Promise<string>; slice(a: number, b: number): Blob }>;
  createWritable(o?: { keepExistingData?: boolean }): Promise<{
    truncate(n: number): Promise<void>;
    seek(n: number): Promise<void>;
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
  }>;
}
export type DirEntry = (DirHandle & { kind: 'directory' }) | (FileHandle & { kind: 'file' });

const INDEX = 'index.json';

/**
 * `writer` replaces `createWritable` (open and the text writes) where the thread cannot use it: the Safari path
 * (WP-650). Reads always stay on this thread.
 */
export function opfsPackStorage(root: () => Promise<DirHandle>, writer?: PackFileWriter): PackStorage {
  const fileOf = opfsFileOf(root);
  const dirOf = opfsDirOf(root);
  const need = async (path: string): Promise<FileHandle> => {
    const f = await fileOf(path, true);
    if (f === undefined) throw new Error(`cannot create ${path}`);
    return f;
  };
  const walk = async (d: DirHandle, prefix: string, out: string[]): Promise<void> => {
    for await (const [name, h] of d.entries()) {
      const p = `${prefix}${decodeURIComponent(name)}`;
      if (h.kind === 'directory') await walk(h, `${p}/`, out);
      else if (p !== INDEX) out.push(p);
    }
  };

  return {
    supported: true,
    size: async (path) => (await (await fileOf(path, false))?.getFile())?.size,
    async open(path, at): Promise<PackWriter> {
      if (writer !== undefined) return writer.open(path, at);
      const w = await (await need(path)).createWritable({ keepExistingData: true });
      await w.truncate(at);
      await w.seek(at);
      return { write: (chunk) => w.write(chunk), close: () => w.close() };
    },
    async read(path, offset, length) {
      const f = await fileOf(path, false);
      if (f === undefined) throw new Error(`no such file: ${path}`);
      return new Uint8Array(await (await f.getFile()).slice(offset, offset + length).arrayBuffer());
    },
    async blob(path) {
      const file = await (await fileOf(path, false))?.getFile();
      return file?.slice(0, file.size); // a slice of a File is a lazy Blob over the same file
    },
    async remove(path) {
      const { dirs, name } = splitPath(path);
      try {
        await (await dirOf(dirs, false)).removeEntry(name);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
    async list() {
      const out: string[] = [];
      await walk(await root(), '', out);
      return out;
    },
    readText: async (path) => (await (await fileOf(path, false))?.getFile())?.text(),
    async writeText(path, text) {
      if (writer !== undefined) return writer.writeText(path, text);
      const w = await (await need(path)).createWritable();
      await w.write(new TextEncoder().encode(text));
      await w.close();
    },
  };
}

const UNSUPPORTED: PackStorage = {
  supported: false,
  size: async () => undefined,
  open: async () => Promise.reject(new Error('offline packs are not supported here')),
  read: async () => new Uint8Array(),
  blob: async () => undefined,
  remove: async () => undefined,
  list: async () => [],
  readText: async () => undefined,
  writeText: async () => undefined,
};

/** The device's OPFS, or a store that reports "not supported" when the browser has none. */
export function deviceOpfsStorage(
  nav: OpfsNavigator | undefined,
  scope: PackScope,
  writer?: PackFileWriter,
): PackStorage {
  const root = deviceRoot(nav);
  if (root === undefined) return UNSUPPORTED;
  return opfsPackStorage(scopedRoot(root, scope), writer);
}

/**
 * Deletes every pack file of this project and person from the device (WP-773), e.g. on sign-out. Other projects and
 * people on the browser keep theirs. A device without OPFS, or without packs of this scope, is already clear.
 */
export async function clearPackScope(nav: OpfsNavigator | undefined, scope: PackScope): Promise<void> {
  const root = deviceRoot(nav);
  if (root === undefined) return;
  const dirs = scopeDirs(scope);
  try {
    const parent = await opfsDirOf(root)(dirs.slice(0, -1), false);
    await parent.removeEntry(dirs[dirs.length - 1] ?? '', { recursive: true });
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

type OpfsNavigator = { storage?: { getDirectory?: () => Promise<unknown> } };

function deviceRoot(nav: OpfsNavigator | undefined): (() => Promise<DirHandle>) | undefined {
  const getDirectory = nav?.storage?.getDirectory?.bind(nav.storage);
  if (getDirectory === undefined) return undefined;
  return async () => (await getDirectory()) as DirHandle;
}
