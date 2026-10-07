import type { SyncErrorCode } from './registry';

export class SyncProtocolError extends Error {
  readonly code: SyncErrorCode;
  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.name = 'SyncProtocolError';
    this.code = code;
  }
}
