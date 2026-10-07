/** The `import_jobs` table (migration 22): all SQL of the import job. */
import { IMPORT_LIMITS, type ImportJobState } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import type { ImportProblem } from '../../io';

export interface JobRow {
  readonly id: string;
  readonly state: ImportJobState;
  readonly mode: string;
  readonly replace: boolean;
  readonly task: string;
  readonly rows_total: number;
  readonly rows_done: number;
  readonly imported: number;
  readonly problem_count: number;
  readonly problems: readonly ImportProblem[];
  /** `accepted` or `refused` once the job is done (a refused atomic import wrote nothing). */
  readonly outcome: string | null;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface Raw extends Omit<JobRow, 'replace' | 'problems'> {
  readonly replace: number;
  readonly problems: string;
}

export const RESTART_REASON =
  'The server restarted while the import was running; nothing is known to be half done.';

export function insertJob(
  db: Db,
  job: { id: string; mode: string; replace: boolean; task: string; now: string },
): void {
  db.prepare(
    `INSERT INTO import_jobs (id, state, mode, replace, task, created_at, updated_at) VALUES (?, 'queued', ?, ?, ?, ?, ?)`,
  ).run(job.id, job.mode, job.replace ? 1 : 0, job.task, job.now, job.now);
}

export interface JobPatch {
  readonly state?: ImportJobState;
  readonly rows_total?: number;
  readonly rows_done?: number;
  readonly imported?: number;
  readonly problems?: readonly ImportProblem[];
  readonly outcome?: string;
  readonly error?: string;
}

/** Writes the given columns; `problems` is capped (`IMPORT_LIMITS.maxProblems`) and its count kept exactly. */
export function updateJob(db: Db, id: string, patch: JobPatch, now: string): void {
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number)[] = [now];
  const set = (column: string, value: string | number): void => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.state !== undefined) set('state', patch.state);
  if (patch.rows_total !== undefined) set('rows_total', patch.rows_total);
  if (patch.rows_done !== undefined) set('rows_done', patch.rows_done);
  if (patch.imported !== undefined) set('imported', patch.imported);
  if (patch.error !== undefined) set('error', patch.error);
  if (patch.outcome !== undefined) set('outcome', patch.outcome);
  if (patch.problems !== undefined) {
    set('problems', JSON.stringify(patch.problems.slice(0, IMPORT_LIMITS.maxProblems)));
    set('problem_count', patch.problems.length);
  }
  db.prepare(`UPDATE import_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
}

/**
 * The job as a client sees it. A `queued` or `running` row that `live` does not know was left by a process that
 * stopped: it becomes `failed` here, so a restart never leaves a job running forever.
 */
export function readJob(db: Db, id: string, live: ReadonlySet<string>, now: string): JobRow | undefined {
  const get = (): Raw | undefined => db.prepare<Raw>('SELECT * FROM import_jobs WHERE id = ?').get(id);
  let raw = get();
  if (raw === undefined) return undefined;
  if ((raw.state === 'queued' || raw.state === 'running') && !live.has(id)) {
    updateJob(db, id, { state: 'failed', error: RESTART_REASON }, now);
    raw = get();
    if (raw === undefined) return undefined;
  }
  return { ...raw, replace: raw.replace === 1, problems: JSON.parse(raw.problems) as ImportProblem[] };
}
