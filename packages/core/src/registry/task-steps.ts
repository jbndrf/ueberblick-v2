import { defineRegistry, type KeyOf } from './define';

/**
 * The kinds of task step (docs/05 "Task steps"). A multi-step task lists them in `steps`; the participant does
 * them in that order and submits once (one run). New kinds append here, with a schema in `schema/task-steps.ts`.
 */
export const TASK_STEP_KINDS = defineRegistry([
  { key: 'form', description: 'The task form: its fields (and pages) are the task `form`.' },
  {
    key: 'quick_edit',
    description: 'Inline edit of the properties the admin picked; an emptied value clears the property.',
  },
  { key: 'location', description: 'Move the pin or redraw the shape of a geometry property.' },
] as const);
export type TaskStepKind = KeyOf<typeof TASK_STEP_KINDS>;

/** Named colours of a task button (a `#rrggbb` hex is allowed as well); the design system maps them to its tokens. */
export const TASK_BUTTON_COLORS = defineRegistry([
  { key: 'primary', description: 'The default action colour.' },
  { key: 'success', description: 'A positive action, for example "erledigt".' },
  { key: 'warning', description: 'An action that needs attention.' },
  { key: 'danger', description: 'A defect report or a destructive action.' },
  { key: 'neutral', description: 'A quiet, supporting action.' },
] as const);
export type TaskButtonColor = KeyOf<typeof TASK_BUTTON_COLORS>;

/** The icons a task button can show (`button.icon`, lucide names as in v3's icon set). The participant app draws exactly these; the builder's icon picker offers exactly these. */
export const TASK_BUTTON_ICONS = defineRegistry([
  { key: 'camera', description: 'Take a photo.' },
  { key: 'check', description: 'Done.' },
  { key: 'clipboard-check', description: 'An inspection or a checklist.' },
  { key: 'leaf', description: 'Care of vegetation.' },
  { key: 'map-pin', description: 'A place.' },
  { key: 'pencil', description: 'Edit.' },
  { key: 'trash-2', description: 'Remove.' },
  { key: 'triangle-alert', description: 'A defect or a warning.' },
  { key: 'wrench', description: 'Repair or maintenance.' },
] as const);
export type TaskButtonIcon = KeyOf<typeof TASK_BUTTON_ICONS>;
