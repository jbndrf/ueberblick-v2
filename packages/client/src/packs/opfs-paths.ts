// Path handling shared by the OPFS reader (main thread) and the writer worker (WP-650): `/`-separated relative
// paths, every part URI-encoded so a layer key can never leave its directory.
import type { DirHandle, FileHandle } from './storage-opfs';

export const isNotFound = (e: unknown): boolean => e instanceof Error && e.name === 'NotFoundError';

export function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').map(encodeURIComponent);
  return { dirs: parts.slice(0, -1), name: parts.at(-1) ?? '' };
}

export function opfsDirOf(root: () => Promise<DirHandle>) {
  return async (dirs: string[], create: boolean): Promise<DirHandle> => {
    let d = await root();
    for (const n of dirs) d = await d.getDirectoryHandle(n, { create });
    return d;
  };
}

/** The file at `path`, or undefined when it (or a directory above it) does not exist and `create` is false. */
export function opfsFileOf(root: () => Promise<DirHandle>) {
  const dirOf = opfsDirOf(root);
  return async (path: string, create: boolean): Promise<FileHandle | undefined> => {
    const { dirs, name } = splitPath(path);
    try {
      return await (await dirOf(dirs, create)).getFileHandle(name, { create });
    } catch (e) {
      if (isNotFound(e)) return undefined;
      throw e;
    }
  };
}

/** Whose packs these are: one project of one person on this browser (WP-773). */
export interface PackScope {
  readonly project: string;
  readonly participant: string;
}

/** `packs/p-<project>/u-<participant>`; the prefixes keep `.` and `..` from ever being a directory name. */
export const scopeDirs = (scope: PackScope): string[] => [
  'packs',
  `p-${encodeURIComponent(scope.project)}`,
  `u-${encodeURIComponent(scope.participant)}`,
];

/** The scope's own directory, created on first use. Every read, write and cleanup of a store stays inside it. */
export function scopedRoot(root: () => Promise<DirHandle>, scope: PackScope): () => Promise<DirHandle> {
  return opfsDirOf(root).bind(null, scopeDirs(scope), true);
}
