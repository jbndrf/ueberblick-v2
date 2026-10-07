// @ueberblick/tool-photo: loaded lazily by the app (`() => import('@ueberblick/tool-photo')`).
import type { FieldTool } from '@ueberblick/ui/tool-api';
import { createPhotoTool } from './photo-tool';
import { createWorkerProcessor } from './worker-client';

export { createPhotoTool } from './photo-tool';
export { DEFAULT_PHOTO_OPTIONS, fitWithin, processImage, readPhotoOptions } from './pipeline';
export type { PhotoOptions, Rasterizer, RasterResult } from './pipeline';
export type { ImageProcessor, ProcessedImage } from './worker-client';

/** The tool the host mounts, with the worker processor (the worker starts on first use). */
export const photoTool: FieldTool = createPhotoTool({ processor: createWorkerProcessor() });
