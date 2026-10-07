/**
 * The one place that turns a content id into an image URL (WP-630, R1). The device shows what is on the device first:
 * bytes the photo tool still holds, then bytes queued with a run (they survive a reload), then the thumbnail kept by
 * Offline-Bilder (WP-667), and only then the server's thumbnail (`?thumb=list|preview`, WP-618). Nothing else in the app builds a blob URL.
 */
import type { ThumbSizeKey } from '@ueberblick/core/registry';
import type { PhotoUrl } from '@ueberblick/ui';
import { serverPhotoUrl } from '../shared/photo-url';
import type { PendingBlobs } from './blobs';

export interface PhotoUrlDeps {
  readonly project: string;
  readonly pending: Pick<PendingBlobs, 'peek'>;
  /** The queue's blobs: `has` is the in-memory key set, `getBlob` reads the bytes. */
  readonly stored: {
    has(sha256: string): boolean;
    getBlob(sha256: string): Promise<Uint8Array | undefined>;
  };
  /** The thumbnails Offline-Bilder keeps; nothing is in it while the switch is off. */
  readonly thumbs?: { get(sha256: string): Promise<Blob | undefined> };
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
}

export interface PhotoUrlResolver extends PhotoUrl {
  /** Revokes every object URL made so far. */
  dispose(): void;
}

export function createPhotoUrl(deps: PhotoUrlDeps): PhotoUrlResolver {
  const local = new Map<string, Promise<string | undefined>>();
  const made: string[] = [];
  const server = serverPhotoUrl(deps.project);

  async function fromDevice(sha256: string): Promise<string | undefined> {
    const held = deps.pending.peek(sha256);
    let blob: Blob | undefined = held?.blob;
    const type = held?.mime;
    if (blob === undefined && deps.stored.has(sha256)) {
      const bytes = await deps.stored.getBlob(sha256);
      if (bytes !== undefined) blob = new Blob([new Uint8Array(bytes)]);
    }
    if (blob === undefined) blob = await deps.thumbs?.get(sha256).catch(() => undefined);
    if (blob === undefined) return undefined;
    const url = deps.createObjectUrl(type === undefined ? blob : blob.slice(0, blob.size, type));
    made.push(url);
    return url;
  }

  const resolve = (async (sha256: string, size: ThumbSizeKey): Promise<string> => {
    let hit = local.get(sha256);
    if (hit === undefined) {
      hit = fromDevice(sha256);
      local.set(sha256, hit);
    }
    const url = await hit;
    if (url !== undefined) return url;
    // Not on the device (any more): do not remember the miss, the bytes may arrive with a later run.
    local.delete(sha256);
    return server(sha256, size);
  }) as PhotoUrlResolver;
  resolve.original = server.original;
  resolve.dispose = () => {
    for (const url of made.splice(0)) deps.revokeObjectUrl(url);
    local.clear();
  };
  return resolve;
}
