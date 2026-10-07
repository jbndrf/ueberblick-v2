/** Checks of the automatic actions `tasks.<task>.auto.<name>` that need no expression (C-004). */
import { AUTO_TIMING_KINDS, TASK_OFFERS } from '../../registry';
import type { TemplateFile } from '../file';
import { autoPath, listAutos } from './autos';
import { taskTypes } from './indexes';
import type { Sink } from './problems';

/** The feature types a task acts on: where it is offered, else (a map or `$none` task) the type it creates. */
function subjectTypes(file: TemplateFile, task: string): readonly string[] {
  const t = file.tasks?.[task];
  if (t === undefined) return [];
  const offered = taskTypes(t);
  return offered.length > 0 ? offered : t.creates !== undefined ? [t.creates] : [];
}

export function checkAutos(file: TemplateFile, sink: Sink): void {
  const tasks = Object.keys(file.tasks ?? {});
  const timings = AUTO_TIMING_KINDS.keys.filter((k) => k !== 'edge');
  for (const a of listAutos(file)) {
    const present = timings.filter((k) => (a.entry as Record<string, unknown>)[k] !== undefined);
    if (present.length > 1) {
      sink.error(
        autoPath(a),
        'auto_timing_conflict',
        `the automatic action '${a.id}' has several timings (${present.join(', ')})`,
        `keep one of ${present.join(', ')}; give the others their own automatic action`,
        { auto: a.id, timings: present.join(', ') },
      );
    }
    if (a.kind === 'after') {
      const after = a.entry.after as string;
      if (!tasks.includes(after)) {
        sink.dangling(autoPath(a, 'after'), 'task', after, tasks);
        continue;
      }
      const mine = taskTypes(file.tasks?.[a.task] ?? { on: [] });
      const theirs = subjectTypes(file, after);
      if (mine.length > 0 && theirs.length > 0 && !theirs.some((t) => mine.includes(t))) {
        sink.error(
          autoPath(a, 'after'),
          'auto_after_other_type',
          `'${a.id}' runs after task '${after}', which acts on ${theirs.join(', ')}, not on ${mine.join(', ')}`,
          `run after a task that acts on ${mine.join(', ')}, or move the automatic action to a task of ${theirs.join(', ')}`,
          { auto: a.id, task: after, types: theirs.join(', '), expected: mine.join(', ') },
        );
      }
    }
    if (a.kind === 'edge') {
      const on = file.tasks?.[a.task]?.on;
      if (typeof on === 'string' && (TASK_OFFERS.keys as readonly string[]).includes(on)) {
        sink.error(
          autoPath(a, 'when'),
          'auto_edge_without_subject',
          `'${a.id}' fires when its \`when\` turns true, but task '${a.task}' is offered on ${on}: there is no feature to watch`,
          'add a timing (after, elapsed, schedule), or offer the task on a feature type',
          { auto: a.id, offer: on },
        );
      }
    }
  }
}
