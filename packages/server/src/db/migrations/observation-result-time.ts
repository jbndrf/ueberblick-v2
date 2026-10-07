import type { Migration } from '../migrate';

/**
 * Audit times read the O&M resultTime (WP-794, owner M8 = b): `observations.result_time` is the time the server
 * received the run (`runs.received_at`), for an import run its historical client time. Back-fill the same way,
 * then recompute the audit columns of `features` (as migration 16). The append-only trigger is recreated with the
 * new column in its guard; it is dropped only for the back-fill.
 */
export const OBSERVATION_RESULT_TIME_MIGRATION: Migration = {
  id: 26,
  name: 'observations_result_time',
  sql: `
DROP TRIGGER observations_no_update;
ALTER TABLE observations ADD COLUMN result_time TEXT;
UPDATE observations SET result_time = (
SELECT CASE WHEN r.actor_kind = 'import' AND r.client_time IS NOT NULL THEN r.client_time ELSE r.received_at END
FROM runs r WHERE r.id = observations.run_id);
CREATE TRIGGER observations_no_update BEFORE UPDATE ON observations
WHEN (SELECT open FROM erasure_guard WHERE id = 1) = 0
OR NEW.result IS NOT 'null'
OR NEW.seq IS NOT OLD.seq OR NEW.run_id IS NOT OLD.run_id OR NEW.feature_id IS NOT OLD.feature_id
OR NEW.property IS NOT OLD.property OR NEW.phenomenon_time IS NOT OLD.phenomenon_time
OR NEW.result_time IS NOT OLD.result_time
BEGIN SELECT RAISE(ABORT, 'observations are append-only: only an erasure run may blank a result'); END;
UPDATE features SET
created_at = (SELECT coalesce(o.result_time, o.phenomenon_time) FROM observations o
              WHERE o.feature_id = features.id AND o.property = '$type' ORDER BY o.seq LIMIT 1),
changed_at = (SELECT coalesce(o.result_time, o.phenomenon_time) FROM observations o
              WHERE o.feature_id = features.id AND coalesce(o.result_time, o.phenomenon_time) IS NOT NULL
              ORDER BY o.seq DESC LIMIT 1);
`,
};
