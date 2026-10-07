// The files of a `file` value (a list of `{ sha256, name, mime }`, WP-603), read for display. One reader for the form
// field and for Daten (R1): the formatter in feature-sheet and the gallery both call `fileRefs`.
import type { Json } from '@ueberblick/core/model';
import type { ThumbSizeKey } from '@ueberblick/core/registry';

// A type alias, not an interface: it must stay assignable to `Json` (a form value).
export type GalleryFile = {
  readonly sha256: string;
  readonly name: string;
  readonly mime: string;
};

/** The one place that turns a content id into something an `<img>` can show (the app implements it, `photo-url.ts`). */
export type PhotoUrl = {
  (sha256: string, size: ThumbSizeKey): string | Promise<string>;
  /**
   * The full file, shown when the thumbnail does not load (v3 showed the original in the tile,
   * `MediaGallery.svelte:260`). Not optional (WP-743): a resolver without it does not typecheck.
   */
  original(sha256: string): string;
};

const SHA256 = /^[0-9a-f]{64}$/;

const isObject = (v: Json | undefined): v is { readonly [k: string]: Json } =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every well-formed entry of a file value; anything else (a stray string, a missing hash) is dropped, never guessed. */
export function fileRefs(value: Json | undefined): readonly GalleryFile[] {
  const items: readonly Json[] = Array.isArray(value)
    ? (value as readonly Json[])
    : value == null
      ? []
      : [value];
  return items.flatMap((x): GalleryFile[] => {
    if (!isObject(x)) return [];
    const { sha256, name, mime } = x;
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return [];
    return [
      {
        sha256,
        name: typeof name === 'string' ? name : sha256.slice(0, 8),
        mime: typeof mime === 'string' ? mime : '',
      },
    ];
  });
}

/** Whether the lightbox and a thumbnail apply: the content type says image. */
export const isImage = (file: GalleryFile): boolean => file.mime.startsWith('image/');
