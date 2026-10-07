/**
 * The header's sync progress (`+layout.svelte:548-554`: "Daten werden synchronisiert (done/total)"). The device
 * counts the features a snapshot has written so far and does not know the total, so the header shows the count.
 */
import type { SyncStatus } from '@ueberblick/client';

/** The number of features loaded while a snapshot is pulled; undefined when no data is moving. */
export const syncProgress = (s: Pick<SyncStatus, 'phase' | 'featuresLoaded'>): number | undefined =>
  s.phase === 'snapshot' ? s.featuresLoaded : undefined;
