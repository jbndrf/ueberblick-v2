import { describe, expect, it } from 'vitest';
import type { QueueStatus, SyncStatus } from '@ueberblick/client';
import { sessionEnded } from './session-end';
import { SYNC_UNAUTHENTICATED } from './sync-transport';

const queue = (hold: string | undefined) => ({ hold, pending: 1 }) as unknown as QueueStatus;
const sync = (message?: string) =>
  ({
    lastError: message === undefined ? undefined : { kind: 'transport', code: undefined, message },
  }) as SyncStatus;

describe('sessionEnded (WP-769)', () => {
  it('a 401 from sending runs or from sync ends the session; any other trouble does not', () => {
    expect(sessionEnded(queue('auth_expired'), sync())).toBe(true);
    expect(sessionEnded(queue(undefined), sync(SYNC_UNAUTHENTICATED))).toBe(true);
    expect(sessionEnded(queue(undefined), sync('sync answered 500'))).toBe(false);
    expect(sessionEnded(queue('backoff'), sync())).toBe(false);
  });
});
