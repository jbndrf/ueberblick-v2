// The main-thread side of the Safari write path (WP-650): a `PackFileWriter` that posts every write to the pack
// writer worker and waits for its answer, so a download never runs ahead of the disk.
import type { PackWriter } from './contract';
import { parseReply, type PackFileWriter, type WriterPort, type WriterRequest } from './writer-protocol';

type Body = WriterRequest extends infer R ? (R extends WriterRequest ? Omit<R, 'id'> : never) : never;

export function workerPackWriter(port: WriterPort): PackFileWriter {
  let seq = 0;
  let handles = 0;
  const waiting = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  port.onmessage = (e) => {
    const reply = parseReply(e.data);
    const w = waiting.get(reply.id);
    waiting.delete(reply.id);
    if (reply.error === undefined) w?.resolve();
    else w?.reject(new Error(reply.error));
  };
  const call = (body: Body, transfer: ArrayBuffer[] = []): Promise<void> =>
    new Promise((resolve, reject) => {
      const id = (seq += 1);
      waiting.set(id, { resolve, reject });
      port.postMessage({ ...body, id }, transfer);
    });

  return {
    async open(path, at): Promise<PackWriter> {
      const handle = (handles += 1);
      await call({ op: 'open', handle, path, at });
      return {
        // a copy is transferred: the caller's chunk may be reused (the transport's read buffers are)
        write: (chunk) => {
          const copy = chunk.slice();
          return call({ op: 'write', handle, chunk: copy }, [copy.buffer]);
        },
        close: () => call({ op: 'close', handle }),
      };
    },
    writeText: (path, text) => call({ op: 'text', path, text }),
  };
}
