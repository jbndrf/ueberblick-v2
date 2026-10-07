import type { Db } from '../../db/driver';

/** The `PlanPorts.isParticipant` of the server (WP-756): a participant of the project that is not disabled. */
export function memberCheck(db: Db): (id: string) => boolean {
  const stmt = db.prepare<{ x: number }>(
    'SELECT 1 AS x FROM participants WHERE id = ? AND disabled_at IS NULL',
  );
  return (id) => stmt.get(id) !== undefined;
}
