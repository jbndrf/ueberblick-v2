import type { TileUploadRefusal } from '@ueberblick/core';

/** A typed refusal of an upload: `reason` is a `TILE_UPLOAD_REFUSALS` key, `message` is for the admin. */
export class TileUploadError extends Error {
  constructor(
    readonly reason: TileUploadRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'TileUploadError';
  }
}
