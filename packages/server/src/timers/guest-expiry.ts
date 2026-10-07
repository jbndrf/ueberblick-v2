/**
 * Guest expiry (WP-639, v3's `self_join_janitor`; WP-1073, owner 2026-10-06 supersedes Q4): a guest who joined through
 * a self-join link is deactivated after 90 days without activity. Last activity is the later of joining and the last
 * use of their session (every authenticated request, so every sync and run, renews it at most daily; a session lives
 * 90 days from its last renewal). So a guest is due when they joined over 90 days ago and hold no live session.
 * Deactivating is the roster's own `removeParticipant` (disables the row, revokes
 * the tokens, ends the sessions), so a guest's runs keep their actor. The beat is the timers loop; one read of the partial index
 * (`participants_guests`) lists the guests who joined over 90 days ago, and one indexed lookup each (`sessions_by_subject`)
 * spares the active ones, so a beat with no old guest costs one empty read.
 */
import type { Auth } from '../auth/contract';
import type { Db } from '../db/driver';
import { removeParticipant } from '../http/participants/roster';

/** Days without activity after which a guest is deactivated (owner 2026-10-06). */
export const GUEST_INACTIVITY_DAYS = 90;
const DAY_MS = 86_400_000;

export interface GuestExpiryDeps {
  readonly db: Db;
  readonly auth: Auth;
  readonly projectId: string;
  readonly now: () => Date;
}

/** Deactivates the guests who were inactive for 90 days; returns how many. */
export function expireGuests(deps: GuestExpiryDeps): number {
  const now = deps.now();
  const cutoff = new Date(now.getTime() - GUEST_INACTIVITY_DAYS * DAY_MS).toISOString();
  const due = deps.db
    .prepare<{ id: string }>(
      'SELECT id FROM participants WHERE self_joined = 1 AND disabled_at IS NULL AND created_at <= ?',
    )
    .all(cutoff);
  const idle = due.filter(({ id }) => !deps.auth.hasLiveSession(deps.projectId, id));
  for (const { id } of idle) removeParticipant({ ...deps, now: () => now }, id);
  return idle.length;
}
