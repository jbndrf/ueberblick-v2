/**
 * Abmelden clears the device (WP-769). v3 `resetAllParticipantState` (reference/src/lib/participant-state/
 * context.svelte.ts:249-310) deleted the participant's IndexedDB, the preference keys and the caches, so the next
 * person on a shared phone starts as on a first visit. Here: the device store, the tool data database, the thumbnail
 * cache, the offline map packs, the eviction marker, the drafts (and their photo bytes) and the preference cache of THAT participant. Other participants' databases and
 * the device-wide settings (language, font size) stay, as in v3. The service worker only caches the app shell (no
 * participant data), so it stays too. Pure over two ports, so it runs under test.
 */
import { prefsCacheKey } from '@ueberblick/client';
import {
  deviceName,
  draftBlobsName,
  draftKeyPrefix,
  draftScope,
  initKey,
  thumbsName,
  toolDataName,
} from './device-names';

export interface WipePorts {
  readonly idb: Pick<IDBFactory, 'deleteDatabase'>;
  readonly storage: Storage;
  /** How long a database that another tab still holds open is waited for; the delete then finishes by itself. */
  readonly blockedMs?: number;
  /** Deletes the offline map packs of this project and person (client `clearPackScope`, WP-773). */
  readonly clearPacks?: (scope: { readonly project: string; readonly participant: string }) => Promise<void>;
  /** Where a failed pack removal is logged; defaults to console.warn. */
  readonly warn?: (message: string, cause: unknown) => void;
}

const BLOCKED_MS = 2000;

function dropDatabase(idb: WipePorts['idb'], name: string, blockedMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new Error(`cannot delete ${name}`));
    // another tab holds it open: the delete completes when that tab closes it; do not hold the sign-out for it
    req.onblocked = () => setTimeout(resolve, blockedMs);
  });
}

export async function wipeParticipantDevice(
  who: { readonly project: string; readonly participant: string },
  ports: WipePorts,
): Promise<void> {
  const { project, participant } = who;
  const name = deviceName(project, participant);
  const blockedMs = ports.blockedMs ?? BLOCKED_MS;
  const results = await Promise.allSettled(
    [name, toolDataName(name), thumbsName(project, participant), draftBlobsName(project, participant)].map(
      (n) => dropDatabase(ports.idb, n, blockedMs),
    ),
  );
  // offline map packs (WP-782): a failure is logged and swallowed, Abmelden still reaches /login
  try {
    await ports.clearPacks?.({ project, participant });
  } catch (e) {
    (ports.warn ?? ((m, c) => console.warn(m, c)))('cannot remove offline map packs', e);
  }
  const draftPrefix = draftKeyPrefix(draftScope(project, participant));
  const exact = new Set([initKey(name), prefsCacheKey(project, participant)]);
  const { storage } = ports;
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key !== null && (exact.has(key) || key.startsWith(draftPrefix))) storage.removeItem(key);
  }
  const failed = results.find((r) => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
