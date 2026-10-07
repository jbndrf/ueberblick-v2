import { z } from '../zod';
import { ExprSchema, KeySchema, LocalizedStringSchema } from './primitives';

const cron = /^\S+( \S+){4}$/;

/**
 * One automatic execution of a task, `tasks.<task>.auto.<name>` (C-004). The system runs the task by itself, as a
 * system run through the same path as a submitted run (R3). At most one timing key; none means an edge on `when`.
 */
export const AutoEntrySchema = z
  .strictObject({
    label: LocalizedStringSchema.optional(),
    after: KeySchema.optional().describe('Timing: after this task ran on the same subject.'),
    change: z
      .string()
      .regex(/^[a-z][a-z0-9_]*\.([a-z][a-z0-9_]*|\*)$/, 'a property change such as baum.vitalitaet')
      .optional()
      .describe('Timing: after this property changed, `<type>.<property>` or `<type>.*`.'),
    elapsed: z
      .strictObject({
        from: ExprSchema.describe('A time expression (date or datetime) the timer follows.'),
        after: ExprSchema.optional().describe('A duration added to `from`.'),
        offset: ExprSchema.optional().describe('A signed duration added to `from` (e.g. -days(14)).'),
      })
      .optional()
      .describe('Timing, server-only: fires when the clock passes from + after + offset.'),
    schedule: z
      .string()
      .regex(cron, 'a cron expression with five fields')
      .optional()
      .describe('Timing, server-only: a cron expression.'),
    idle: ExprSchema.optional().describe(
      "With `schedule`: a duration (e.g. days(7)). The schedule visits every Objekt of the task's Objektart and fires only on those whose last change is at least this long ago.",
    ),
    when: ExprSchema.optional().describe(
      'ANDed with the task `when`. Without a timing both together fire the entry when a run turns them false -> true; with a timing they must also hold.',
    ),
  })
  .superRefine((e, ctx) => {
    // More than one timing is a compile problem (`auto_timing_conflict`), so it shows with its path and fix.
    // An entry without a timing and without `when` needs the task `when`: checked by `TaskSchema`.
    if (e.idle !== undefined && e.schedule === undefined) {
      ctx.addIssue({ code: 'custom', path: ['idle'], message: '`idle` belongs to a `schedule`' });
    }
  })
  .describe('An automatic execution of the task: timing + optional condition.');
export type AutoEntry = z.infer<typeof AutoEntrySchema>;
