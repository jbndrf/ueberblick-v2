import type { Db } from '../db/driver';

/** Whether the participant holds an unexpired session in the project (WP-1073): one lookup of `sessions_by_subject`. */
export function hasLiveSession(
  control: Db,
  projectId: string,
  participantId: string,
  nowIso: string,
): boolean {
  return (
    control
      .prepare('SELECT 1 FROM sessions WHERE subject = ? AND project_id = ? AND expires_at > ? LIMIT 1')
      .get(`participant:${participantId}`, projectId, nowIso) !== undefined
  );
}
