/**
 * The server side of the one photo URL resolver (WP-743, R1): the thumbnail (`?thumb=list|preview`, WP-618) and the
 * original of a project blob. The participant app puts device bytes in front of it (`../participant/photo-url.ts`),
 * the admin Protokoll uses it as it is. `original` is not optional: a thumbnail that fails falls back to it.
 */
import type { PhotoUrl } from '@ueberblick/ui';

/** A resolver that cannot be built without `original`. */
export type ServerPhotoUrl = PhotoUrl;

const blobBase = (project: string, sha256: string): string =>
  `/api/p/${encodeURIComponent(project)}/blobs/${sha256}`;

export function serverPhotoUrl(project: string): ServerPhotoUrl {
  const resolve = (sha256: string, size: Parameters<PhotoUrl>[1]): string =>
    `${blobBase(project, sha256)}?thumb=${size}`;
  return Object.assign(resolve, { original: (sha256: string): string => blobBase(project, sha256) });
}
