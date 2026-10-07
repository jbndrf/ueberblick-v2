// Keeps what the Offline tab shows in step with the pack manager: the progress of every pack, and the storage counts,
// which are read again whenever the set of ready packs changes (not on every byte).
import type { PackCounts, PackManager, PackProgress } from '@ueberblick/client';

export interface PackView {
  readonly progress: Readonly<Record<string, PackProgress>>;
  /** Undefined until the first read of the device's index. */
  readonly counts: PackCounts | undefined;
}

const readySignature = (p: Readonly<Record<string, PackProgress>>): string =>
  Object.entries(p)
    .filter(([, v]) => v.state === 'ready')
    .map(([k]) => k)
    .sort()
    .join('|');

/** Calls `run` at once and on every change; returns the unsubscribe. */
export function watchPacks(manager: PackManager, run: (view: PackView) => void): () => void {
  let counts: PackCounts | undefined;
  let signature: string | undefined;
  let stopped = false;
  const stop = manager.progress.subscribe((progress) => {
    run({ progress, counts });
    const now = readySignature(progress);
    if (now === signature) return;
    signature = now;
    void manager.counts().then((c) => {
      if (stopped) return;
      counts = c;
      run({ progress: manager.progress.get(), counts });
    });
  });
  return () => {
    stopped = true;
    stop();
  };
}

/**
 * Calls `run` when the set of ready packs changes (a download is ready, a pack is deleted), not for the state at the
 * time of subscribing. The map re-applies its basemaps then, so a pack is used the moment it is stored (v3 checked
 * the pack store per tile request).
 */
export function onReadyPacksChange(manager: PackManager, run: () => void): () => void {
  let signature: string | undefined;
  return manager.progress.subscribe((progress) => {
    const now = readySignature(progress);
    const first = signature === undefined;
    const changed = now !== signature;
    signature = now;
    if (!first && changed) run();
  });
}
