import type { BrandingIconType } from '@ueberblick/core';

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  sig.every((x, i) => b[at + i] === x);

/** Whether the first bytes are the image the type names (the `Content-Type` alone is the client's word). */
export function matchesImageType(bytes: Uint8Array, mime: BrandingIconType): boolean {
  switch (mime) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case 'image/svg+xml':
      return new TextDecoder().decode(bytes.subarray(0, 1024)).includes('<svg');
  }
}
