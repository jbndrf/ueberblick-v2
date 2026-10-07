/**
 * The sync endpoint's handlers (WP-106) over the runtime's per-project services: the sync service and the doorbell
 * are the ones the run store rings (`projectStoresFor(runtime())`), so a run commits, rings, and listeners pull.
 */
import { createSyncHandlers, type SyncHandlers } from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';

let handlers: SyncHandlers | undefined;

export function syncHandlers(): SyncHandlers {
  handlers ??= createSyncHandlers({
    log: runtime().log,
    project: (key) => runtime().participantProject(key),
    rolesFor: (accountId, projectId) => runtime().auth.rolesFor(accountId, projectId),
    service: (key) => runtime().services.sync(key),
    doorbell: (key) => runtime().services.doorbell(key),
    toolBell: runtime().services.toolBell,
  });
  return handlers;
}
