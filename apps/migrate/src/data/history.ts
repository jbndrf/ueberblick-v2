/**
 * The v3 log of one instance as steps, one per v3 run. v3 keeps the rows in insertion order (the order in
 * which the server recorded them); that order is the history and it is kept. The time of a step is its
 * phenomenon time (what the observer said), which may be earlier than the recording of an offline device.
 */
import { toInstant } from './read';
import type { V3LogRow } from './types';

export interface Step {
  /** The phenomenon time as an instant, `undefined` when neither time can be read. */
  readonly time: string | undefined;
  readonly observer: string | undefined;
  readonly run: string;
  readonly rows: readonly V3LogRow[];
}

/** Rows ordered as v3 recorded them: by recording time, and by position where the times are equal or unreadable. */
function recorded(rows: readonly V3LogRow[]): readonly V3LogRow[] {
  let last = Number.NEGATIVE_INFINITY;
  const keyed = rows.map((row, position) => {
    const ms = Date.parse(toInstant(row.recordedAt) ?? '');
    if (!Number.isNaN(ms)) last = ms;
    return { row, position, ms: last };
  });
  keyed.sort((a, b) => a.ms - b.ms || a.position - b.position);
  return keyed.map((k) => k.row);
}

/**
 * Consecutive rows of one v3 run with one phenomenon time make a step. A field that occurs twice in a
 * step starts the next one (a run's input holds a field once).
 */
export function steps(log: readonly V3LogRow[]): readonly Step[] {
  const out: {
    time: string | undefined;
    observer: string | undefined;
    run: string;
    rows: V3LogRow[];
  }[] = [];
  for (const row of recorded(log)) {
    const time = toInstant(row.observedAt) ?? toInstant(row.recordedAt);
    const open = out[out.length - 1];
    const name = row.field ?? row.system;
    const same =
      open !== undefined &&
      open.run === row.run &&
      open.time === time &&
      open.observer === row.observer &&
      !open.rows.some(
        (r) => (r.field ?? r.system) === name && (r.field === undefined) === (row.field === undefined),
      );
    if (same) open.rows.push(row);
    else out.push({ time, observer: row.observer, run: row.run, rows: [row] });
  }
  return out;
}
