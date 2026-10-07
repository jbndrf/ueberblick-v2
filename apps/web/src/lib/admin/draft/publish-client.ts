/**
 * The browser side of the publish bar (WP-326): reads the draft status. Deploying is the deploy overview's job
 * (`../deploy/`, WP-360); the simple confirm of A-030 is gone.
 */
import type { DraftStatus } from '@ueberblick/server';

/** The status as the browser gets it (`GET /api/admin/p/<project>/draft/status`). */
export type DraftStatusView = DraftStatus;

export interface PublishClient {
  /** The status, or null when it cannot be read (the shell then shows no bar). */
  status(): Promise<DraftStatusView | null>;
}

/** Where the admin fixes problems or moves values: the Objektart's builder; without a known one, the project's Versionen page. */
export const builderHref = (project: string, type: string | null): string =>
  type === null ? `/admin/projects/${project}/versions` : `/admin/projects/${project}/types/${type}/builder`;

const isStatus = (v: unknown): v is DraftStatusView =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as DraftStatusView).dirty === 'boolean' &&
  typeof (v as DraftStatusView).neverPublished === 'boolean' &&
  typeof (v as DraftStatusView).problems === 'number';

export function createPublishClient(opts: {
  readonly project: string;
  readonly fetch: typeof fetch;
}): PublishClient {
  return {
    async status() {
      try {
        const res = await opts.fetch(`/api/admin/p/${opts.project}/draft/status`);
        if (!res.ok) return null;
        const body: unknown = await res.json();
        return isStatus(body) ? body : null;
      } catch {
        return null;
      }
    },
  };
}
