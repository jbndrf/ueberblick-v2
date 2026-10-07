import { KeySchema, type Key } from '@ueberblick/core';
import type { Db } from '../db/driver';

/**
 * Reads a participant's roles from `participants.roles` (a JSON array of role keys) in a project database.
 * `null` (refused: 401) when `disabled_at` is set or there is no roster row: A-025 supersedes A-014, because
 * every real participant has a roster row (WP-168), so a credential for another id fails closed.
 */
export function participantRolesOf(db: Db, participantId: string): readonly Key[] | null {
  const row = db
    .prepare<{ roles: string; disabled_at: string | null }>(
      'SELECT roles, disabled_at FROM participants WHERE id = ?',
    )
    .get(participantId);
  if (!row) return null;
  if (row.disabled_at) return null;
  const parsed: unknown = JSON.parse(row.roles);
  if (!Array.isArray(parsed)) throw new Error(`participants.roles of ${participantId} is not an array`);
  return parsed.map((r) => KeySchema.parse(r) as Key);
}
