/**
 * Whether the server ended this session (WP-769): a 401 on sending runs holds the queue (`auth_expired`), a 401 on a sync
 * page fails the pull with `SYNC_UNAUTHENTICATED`. The sync runs in a worker and only its failure text crosses over, so
 * the text is the one signal. v3 went to /login on it (docs/research/v3-parity/v3-participant.md:120).
 */
import type { QueueStatus, SyncStatus } from '@ueberblick/client';
import { SYNC_UNAUTHENTICATED } from './sync-transport';

export function sessionEnded(queue: QueueStatus, sync: SyncStatus): boolean {
  return queue.hold === 'auth_expired' || sync.lastError?.message === SYNC_UNAUTHENTICATED;
}
