import { defineRegistry, type KeyOf, type RegistryEntry } from './define';

/**
 * Named thumbnail sizes for `?thumb=<size>` on the blob route (WP-618). The server makes one derived
 * WebP per (blob, size) and caches it next to the blob. The sizes are the v3 ones (`?thumb=80x80`,
 * `?thumb=800x0f`).
 */
export interface ThumbSizeEntry<K extends string = string> extends RegistryEntry<K> {
  /** Target width in pixels. */
  readonly width: number;
  /** Target height in pixels; omitted keeps the aspect ratio. */
  readonly height?: number;
  /** With a `height`: center-crop (cover) to the exact box. */
  readonly crop?: boolean;
}

export const THUMB_SIZES = defineRegistry([
  {
    key: 'list',
    description: 'An 80x80 center-cropped square for lists.',
    width: 80,
    height: 80,
    crop: true,
  },
  { key: 'preview', description: '800 pixels wide, aspect preserved.', width: 800 },
] as const);
export type ThumbSizeKey = KeyOf<typeof THUMB_SIZES>;
