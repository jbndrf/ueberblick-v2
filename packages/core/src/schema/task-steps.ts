import { z } from '../zod';
import { TASK_BUTTON_COLORS, TASK_STEP_KINDS } from '../registry';
import { KeySchema, LocalizedStringSchema } from './primitives';

/**
 * One step of a multi-step task (registry `TASK_STEP_KINDS`). The fields of a `form` step stay in the task's
 * keyed `form` map, because overlays and breaking-change checks address entities by key path and never
 * descend into an array (docs/05); `steps` only orders the steps.
 */
export const TaskStepSchema = z
  .discriminatedUnion('kind', [
    z
      .strictObject({ kind: z.literal('form').describe('The step kind.') })
      .describe('The task form, at this position of the sequence.'),
    z
      .strictObject({
        kind: z.literal('quick_edit').describe('The step kind.'),
        properties: z
          .array(KeySchema)
          .min(1)
          .describe('Properties of the task subject, edited inline. An emptied value clears the property.'),
      })
      .describe('Inline edit of the picked properties.'),
    z
      .strictObject({
        kind: z.literal('location').describe('The step kind.'),
        property: KeySchema.describe('A geometry property of the task subject.'),
      })
      .describe('Move the pin or redraw the shape.'),
  ])
  .describe(`One step: ${TASK_STEP_KINDS.keys.join(', ')}.`);
export type TaskStep = z.infer<typeof TaskStepSchema>;

const colorKeys = TASK_BUTTON_COLORS.keys as unknown as [string, ...string[]];

/** How the task shows as a button in the action row (v3 `visual.button_*`). */
export const TaskButtonSchema = z
  .strictObject({
    label: LocalizedStringSchema.optional().describe('A short button label; the task label when absent.'),
    color: z
      .union([z.enum(colorKeys), z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a named colour or #rrggbb')])
      .optional()
      .describe(`A named colour (${TASK_BUTTON_COLORS.keys.join(', ')}) or a #rrggbb hex.`),
    icon: z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/, 'an icon key such as "triangle-alert"')
      .optional()
      .describe('An icon key of the design system.'),
  })
  .describe('Presentation of the task button.');
export type TaskButton = z.infer<typeof TaskButtonSchema>;
