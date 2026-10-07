import type { Db } from '../db/driver';
import type { AccessLog } from './contract';

/** Writes `access_log` (project migration 7): who looked at personal data and when. Ids and times only, never values. */
export function sqliteAccessLog(db: Db): AccessLog {
  const insert = db.prepare('INSERT INTO access_log (at, actor, action, subject) VALUES (?, ?, ?, ?)');
  return {
    record: (e) => void insert.run(e.at, e.actor, e.action, e.subject),
  };
}
