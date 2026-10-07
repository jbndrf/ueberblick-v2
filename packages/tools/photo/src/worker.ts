// Worker entry: decode, resize and encode off the main thread.
import { canvasRasterizer } from './canvas-raster';
import { processImage, type PhotoOptions } from './pipeline';
import type { WorkerReply, WorkerRequest } from './worker-client';

interface Scope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerReply): void;
}
const scope = self as unknown as Scope;

scope.onmessage = async (e) => {
  const { id, file, options } = e.data;
  try {
    const original = new Uint8Array(await file.arrayBuffer());
    const out = await processImage(original, options satisfies PhotoOptions, canvasRasterizer);
    const blob = new Blob([out.bytes as BlobPart], { type: 'image/jpeg' });
    scope.postMessage({ id, ok: true, blob, width: out.width, height: out.height });
  } catch (err) {
    scope.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
