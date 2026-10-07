import { parseCron } from '../../rules/timing/cron';
import type { Ty } from '../../expr/check';
import type { AutoEntry } from '../auto';
import { autoPath, type Auto } from './autos';
import type { Sink } from './problems';

/** A schedule with `idle` is a sweep over the Objekte of the task's Objektart: `self` is one of them. */
export const isSweep = (entry: AutoEntry): boolean =>
  entry.schedule !== undefined && entry.idle !== undefined;

/**
 * An automatic action's `schedule` must be a cron expression, and its `idle` a duration over `self` (docs/05);
 * `idle` needs a task offered on an Objektart (`self` set), and a `schedule` without `idle` on such a task has no
 * subject: it is refused on every tick. `checkIdle` type-checks and stores the expression.
 */
export function checkSchedule(
  sink: Sink,
  a: Auto,
  self: Ty | undefined,
  checkIdle: (path: string, source: string) => void,
): void {
  const { entry } = a;
  if (entry.idle !== undefined) {
    const path = autoPath(a, 'idle');
    if (self === undefined)
      sink.error(
        path,
        'expression_type',
        'an idle sweep visits the Objekte of the task, but the task is not offered on an Objektart',
        'offer the task on an Objektart, or remove idle',
        {},
      );
    else checkIdle(path, entry.idle);
  } else if (self !== undefined) {
    sink.error(
      autoPath(a, 'schedule'),
      'auto_schedule_without_idle',
      `the schedule of '${a.id}' has no subject: the task is offered on an Objektart, so it needs \`idle\` and is refused on every tick`,
      'add `idle` (a duration), so the schedule visits the Objekte of the task, or offer the task on $none',
      { auto: a.id },
    );
  }
  const cron = parseCron(entry.schedule as string);
  if (cron.ok) return;
  const at = cron.error.position;
  sink.error(
    autoPath(a, 'schedule'),
    'expression_parse',
    `not a cron expression: ${cron.error.message}`,
    'write five fields: minute hour day-of-month month day-of-week, e.g. "0 6 * * *"',
    { detail: cron.error.message, position: at },
    { start: at, end: at + 1 },
  );
}
