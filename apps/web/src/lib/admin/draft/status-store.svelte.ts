/**
 * The draft status the admin shell shows (bar and sidebar badge). One store per browser tab: the shell
 * refreshes it when the project or the page changes, and an admin page that changed the draft calls
 * `notifyDraftChanged()` so the bar follows at once (every admin page edits the draft through the same client).
 */
import { createPublishClient, type DraftStatusView } from './publish-client';

class DraftStatusStore {
  status = $state<DraftStatusView | null>(null);
  /** The project `status` belongs to; a status of another project is never shown. */
  project = $state<string | null>(null);
  /** Counts `notifyDraftChanged()` calls; the shell refreshes when it moves. */
  changes = $state(0);

  async refresh(project: string, fetchFn: typeof fetch = fetch): Promise<void> {
    const next = await createPublishClient({ project, fetch: fetchFn }).status();
    if (next === null && this.project === project) return; // keep what is shown when a read fails
    this.project = project;
    this.status = next;
  }

  clear(): void {
    this.project = null;
    this.status = null;
  }
}

export const draftStatus = new DraftStatusStore();

/** Called by an admin page after it saved the draft: the bar re-reads the status. */
export function notifyDraftChanged(): void {
  draftStatus.changes += 1;
}
