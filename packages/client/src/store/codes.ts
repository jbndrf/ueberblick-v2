import type { StoreErrorCode } from '@ueberblick/core/registry';

export class DeviceStoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DeviceStoreError';
  }
}
