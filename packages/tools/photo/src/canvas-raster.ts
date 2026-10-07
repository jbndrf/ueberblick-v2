// Browser rasterizer: OffscreenCanvas, used inside the worker (never on the main thread).
import { fitWithin, type Rasterizer } from './pipeline';

export const canvasRasterizer: Rasterizer = async (bytes, target) => {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), { imageOrientation: 'from-image' });
  const { width, height } = fitWithin(bitmap.width, bitmap.height, target.maxEdge);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas is not available');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: target.quality });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
};
