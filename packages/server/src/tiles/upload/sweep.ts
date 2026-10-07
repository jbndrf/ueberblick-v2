import { tileUploadMax } from '@ueberblick/core';
import type { TileUploadStore, UploadJob } from './store';

export interface StaleUploadSweepDeps {
  readonly store: TileUploadStore;
  readonly now: () => string;
  /** A failure for one upload or project: logged by the caller, never thrown. */
  readonly onError?: (project: string, id: string | undefined, error: unknown) => void;
}

/**
 * Removes the uploads of `projects` that are still `receiving` and were last touched more than
 * `TILE_UPLOAD_MAX.stale_hours` ago (an admin closed the tab): their bytes and job record. Runs at startup; idempotent;
 * a failure is reported through `onError` and never thrown. Returns how many uploads it removed.
 */
export function sweepStaleUploads(deps: StaleUploadSweepDeps, projects: readonly string[]): number {
  const limit = Date.parse(deps.now()) - tileUploadMax('stale_hours') * 3_600_000;
  let removed = 0;
  for (const project of projects) {
    let jobs: UploadJob[];
    try {
      jobs = deps.store.jobs(project);
    } catch (e) {
      deps.onError?.(project, undefined, e);
      continue;
    }
    for (const job of jobs) {
      if (job.state !== 'receiving' || !(Date.parse(job.updatedAt) < limit)) continue;
      try {
        deps.store.removeAll(project, job.id);
        removed++;
      } catch (e) {
        deps.onError?.(project, job.id, e);
      }
    }
  }
  return removed;
}
