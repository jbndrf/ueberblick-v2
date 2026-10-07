// The pack writer worker's side (WP-650): writes layer bytes and the index through a sync access handle, the only
// OPFS write Safari has. One handle per open file; every error travels back as text, never swallowed.
import type { DirHandle, FileHandle } from './storage-opfs';
import { opfsFileOf } from './opfs-paths';
import { parseRequest, type WriterPort, type WriterReply, type WriterRequest } from './writer-protocol';

export interface SyncAccessHandle {
  write(buffer: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
export type SyncFileHandle = FileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> };
export type SyncDirHandle = Omit<DirHandle, 'getFileHandle'> & {
  getFileHandle(name: string, o?: { create?: boolean }): Promise<SyncFileHandle>;
};

interface Open {
  readonly file: SyncAccessHandle;
  at: number;
}

export function serveWriter(port: WriterPort, root: () => Promise<SyncDirHandle>): void {
  const open = new Map<number, Open>();
  const fileOf = opfsFileOf(root as unknown as () => Promise<DirHandle>);

  const syncFile = async (path: string): Promise<SyncAccessHandle> => {
    const f = (await fileOf(path, true)) as SyncFileHandle | undefined;
    if (f === undefined) throw new Error(`cannot create ${path}`);
    return f.createSyncAccessHandle();
  };

  async function run(req: WriterRequest): Promise<void> {
    if (req.op === 'open') {
      const file = await syncFile(req.path);
      try {
        file.truncate(req.at);
      } catch (e) {
        file.close();
        throw e;
      }
      open.set(req.handle, { file, at: req.at });
    } else if (req.op === 'write') {
      const h = open.get(req.handle);
      if (h === undefined) throw new Error('writer: no such handle');
      h.file.write(req.chunk, { at: h.at });
      h.at += req.chunk.length;
    } else if (req.op === 'close') {
      const h = open.get(req.handle);
      open.delete(req.handle);
      if (h === undefined) return;
      try {
        h.file.flush();
      } finally {
        h.file.close();
      }
    } else {
      const file = await syncFile(req.path);
      try {
        file.truncate(0);
        file.write(new TextEncoder().encode(req.text), { at: 0 });
        file.flush();
      } finally {
        file.close();
      }
    }
  }

  port.onmessage = (e) => {
    void (async () => {
      let id = -1;
      let reply: WriterReply;
      try {
        const req = parseRequest(e.data);
        id = req.id;
        await run(req);
        reply = { id };
      } catch (err) {
        reply = { id, error: err instanceof Error ? err.message : String(err) };
      }
      port.postMessage(reply);
    })();
  };
}
