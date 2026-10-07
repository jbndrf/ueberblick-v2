// Main-thread side of the worker: sends the file, gets the processed JPEG back. The worker starts on
// first use.
import type { PhotoOptions } from './pipeline';

export interface ProcessedImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

/** The port the tool uses. The default runs in a worker; tests pass a fake. */
export interface ImageProcessor {
  process(file: Blob, options: PhotoOptions): Promise<ProcessedImage>;
}

export interface WorkerRequest {
  readonly id: number;
  readonly file: Blob;
  readonly options: PhotoOptions;
}
export type WorkerReply =
  | {
      readonly id: number;
      readonly ok: true;
      readonly blob: Blob;
      readonly width: number;
      readonly height: number;
    }
  | { readonly id: number; readonly ok: false; readonly message: string };

export function createWorkerProcessor(): ImageProcessor {
  let worker: Worker | undefined;
  let next = 0;
  const pending = new Map<number, { resolve: (v: ProcessedImage) => void; reject: (e: Error) => void }>();

  function start(): Worker {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve({ blob: e.data.blob, width: e.data.width, height: e.data.height });
      else p.reject(new Error(e.data.message));
    };
    w.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('The image worker failed'));
      pending.clear();
      worker = undefined;
    };
    return w;
  }

  return {
    process(file, options) {
      const w = (worker ??= start());
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, file, options } satisfies WorkerRequest);
      });
    },
  };
}
