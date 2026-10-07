import { z } from '../zod';
import {
  AUTO_TIMING_KINDS,
  FORM_APPEARANCES,
  LIFECYCLE_STATES,
  PROPERTY_DISPLAY_COLUMNS,
  type PropertyDisplayColumn,
  TASK_OFFERS,
  THEN_STEP_KINDS,
} from '../registry';
import type { TaskStep } from './task-steps';
import { PersonalSubjectSchema } from './property';
import { ExprSchema, FormKeySchema, KeyPathSchema, KeySchema, LocalizedStringSchema } from './primitives';
import { stepProperties } from './steps-of';
import { TaskButtonSchema, TaskStepSchema } from './task-steps';
import { AutoEntrySchema } from './auto';
import { ValueSchema } from './value';

export { ValueSchema };

const columnKeys = PROPERTY_DISPLAY_COLUMNS.keys as unknown as [
  PropertyDisplayColumn,
  ...PropertyDisplayColumn[],
];
const lifecycleKeys = LIFECYCLE_STATES.keys as unknown as [string, ...string[]];
const offerKeys = TASK_OFFERS.keys as unknown as [string, ...string[]];

/** The title and description of a form page (v3 `FormPage`); the field that carries it starts the page. */
export const FormPageSchema = z
  .strictObject({
    label: LocalizedStringSchema.optional().describe('The page title: the tab and the heading.'),
    hint: LocalizedStringSchema.optional().describe('The description under the heading.'),
  })
  .describe('Starts a form page at this field.');

const AppearanceSchema = z
  .string()
  .min(1)
  .superRefine((v, ctx) => {
    for (const t of v.split(/\s+/).filter(Boolean)) {
      if (!FORM_APPEARANCES.has(t)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown appearance "${t}"; one of: ${FORM_APPEARANCES.keys.join(', ')}`,
        });
      }
    }
  });

/** A field of a task's form, bound to a property. ODK vocabulary (docs/02 corollaries). */
export const FormFieldSchema = z
  .strictObject({
    label: LocalizedStringSchema.optional().describe('Overrides the property label in this form.'),
    relevant: ExprSchema.optional().describe('Field is shown and submitted only while this is true.'),
    required: z.union([z.boolean(), ExprSchema]).optional().describe('true, or an expression.'),
    constraint: ExprSchema.optional().describe(
      'Must be true for the value to be accepted; `value` is the input.',
    ),
    constraint_message: LocalizedStringSchema.optional().describe('Shown when the constraint fails.'),
    calculate: ExprSchema.optional().describe(
      'Computes the value (also used to prefill from the current value).',
    ),
    readonly: z.union([z.boolean(), ExprSchema]).optional().describe('true, or an expression.'),
    choice_filter: ExprSchema.optional().describe(
      'select/multiselect: true for an option that is offered; `option` is the option key, next to `form` and `self` (ODK choice_filter).',
    ),
    placeholder: LocalizedStringSchema.optional().describe(
      'Grey hint inside an empty text, number or choice input (v3 placeholder).',
    ),
    page: FormPageSchema.optional().describe(
      'This field starts a new page of the form; the title and description are drawn on that page.',
    ),
    appearance: AppearanceSchema.optional().describe(
      'A space-separated list of rendering hints for the form renderer (registry FORM_APPEARANCES).',
    ),
    tool: KeySchema.optional().describe('The key of a tool that produces the value.'),
    column: z
      .enum(columnKeys)
      .optional()
      .describe(
        'Width of the field in this form: full (default), left or right (two half-width cells of one row sit side by side, also on a phone). The Daten view has its own (`display.column`).',
      ),
    row: z
      .number()
      .optional()
      .describe(
        'The line of the field in this form: neighbours with the same row share a line; one without a row is a line of its own. The Daten view has its own (`display.row`).',
      ),
  })
  .describe('One field of a form.');

/** The `redact` step (B-005): erase the personal values of one subject; the erasure run is an ordinary run (R3). */
export const RedactStepSchema = z
  .strictObject({
    subject: PersonalSubjectSchema,
    of: ExprSchema.optional().describe(
      'Who or what is erased: for `actor` and `property:<key>` an expression giving the participant id (for example `form.subject`); for `feature` a feature (default: the task subject).',
    ),
  })
  .describe('Erases the personal values of the subject: the same kinds `personal.subject` uses.');

/** One step of `then`: exactly one kind's key (registry `THEN_STEP_KINDS`), plus the conditions. */
export const ThenStepSchema = z
  .strictObject({
    set: z
      .record(KeyPathSchema, ValueSchema)
      .optional()
      .describe(
        'Property key (or bound-feature path) to a value. A string is always an expression (a literal option key is written "\'massnahme\'"); numbers, booleans and null are literals.',
      ),
    redact: RedactStepSchema.optional(),
    lifecycle: z
      .enum(lifecycleKeys)
      .optional()
      .describe('Sets the system lifecycle of the task subject: active, completed, archived or deleted.'),
    of: ExprSchema.optional().describe(
      'On `set` and `lifecycle`: a feature or a list of features (e.g. self.kinder) the step acts on instead of the task subject. Each is checked like the subject; at most THEN_STEP_TARGETS_MAX.',
    ),
    when: ExprSchema.optional().describe('The step runs only when this is true.'),
    otherwise: z
      .literal(true)
      .optional()
      .describe('The step runs only when no earlier conditional step ran.'),
  })
  .superRefine((step, ctx) => {
    const present = THEN_STEP_KINDS.keys.filter((k) => step[k] !== undefined);
    if (present.length === 0) {
      ctx.addIssue({ code: 'custom', message: `a step has one of: ${THEN_STEP_KINDS.keys.join(', ')}` });
    }
    if (step.set !== undefined && Object.keys(step.set).length === 0) {
      ctx.addIssue({ code: 'custom', path: ['set'], message: '`set` names at least one property' });
    }
    if (present.length > 1) {
      ctx.addIssue({
        code: 'custom',
        message: `a step has one of: ${THEN_STEP_KINDS.keys.join(', ')}, not several`,
      });
    }
    if (step.of !== undefined && step.set === undefined && step.lifecycle === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['of'],
        message: '`of` belongs to a `set` or `lifecycle` step (a `redact` step has its own `of`)',
      });
    }
    if (
      step.redact !== undefined &&
      !step.redact.subject.startsWith('feature') &&
      step.redact.of === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['redact', 'of'],
        message: `redacting subject '${step.redact.subject}' needs \`of\`: an expression giving the participant id`,
      });
    }
  })
  .describe('One step run after the form is accepted.');
export type ThenStep = z.infer<typeof ThenStepSchema>;

export const TaskOnSchema = z
  .union([
    z.enum(offerKeys).describe('A special offer: $map or $none.'),
    KeySchema.describe('A feature type key.'),
    z.array(KeySchema).min(1).describe('Several feature type keys.'),
  ])
  .describe('Where the task is offered: a feature type key, a list of them, "$map" or "$none".');

/** `steps` against `form`: the form step is where `form` runs; no property is written by two steps. */
function checkSteps(
  t: { steps?: readonly TaskStep[] | undefined; form?: object | undefined },
  ctx: z.RefinementCtx,
): void {
  if (t.steps === undefined) return;
  const formSteps = t.steps.filter((s) => s.kind === 'form').length;
  const hasForm = t.form !== undefined;
  const bad = (message: string, path: string[] = ['steps']): void =>
    ctx.addIssue({ code: 'custom', path, message });
  if (formSteps > 1) bad('`steps` has at most one `form` step: the form keeps its own pages');
  else if (hasForm && formSteps === 0)
    bad('the task has a `form`: add a `{ kind: form }` step where it runs');
  else if (!hasForm && formSteps === 1) bad('a `form` step needs the task `form`', ['form']);
  else if (t.steps.length === 1 && formSteps === 1) bad('a task with only its form omits `steps`');
  const seen = new Set(Object.keys(t.form ?? {}));
  for (const key of stepProperties(t)) {
    if (seen.has(key)) bad(`'${key}' is written by two steps of the task`);
    seen.add(key);
  }
}

export const TaskSchema = z
  .strictObject({
    label: LocalizedStringSchema.describe('The name shown to participants.'),
    description: LocalizedStringSchema.optional(),
    on: TaskOnSchema,
    who: z
      .array(KeySchema)
      .min(1)
      .optional()
      .describe(
        'The roles whose people may run the task, plus the reserved `admin` (an admin account). Without `who` no person may run it: it is automatic only (C-004).',
      ),
    when: ExprSchema.optional().describe(
      'The one shared condition (state only: stage, values, time): the task is available, to people and to its automatic actions, only while this is true.',
    ),
    creates: KeySchema.optional().describe(
      'The feature type key this task creates. Required for `on: $map`; optional for others (a feature-creating task on $none names it too).',
    ),
    bind: z
      .record(KeySchema, ExprSchema)
      .optional()
      .describe('Related features by name: expressions over declared relations only.'),
    form: z
      .record(FormKeySchema, FormFieldSchema)
      .optional()
      .describe(
        'Fields by property key; `<bind>.<property>` shows and edits a property of a bound Objekt (A-047).',
      ),
    steps: z
      .array(TaskStepSchema)
      .min(1)
      .optional()
      .describe(
        'The ordered steps of a multi-step task, submitted as one run. Without `steps` the task is its form (or one tap).',
      ),
    button: TaskButtonSchema.optional(),
    confirm: LocalizedStringSchema.optional().describe('Asked before the run is submitted, when set.'),
    then: z.array(ThenStepSchema).optional().describe('Steps applied after the form, in order.'),
    auto: z
      .record(KeySchema, AutoEntrySchema)
      .optional()
      .describe('Automatic executions of this task by name: the system runs it by itself (C-004).'),
  })
  .superRefine((t, ctx) => {
    if (t.on === '$map' && t.creates === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['creates'],
        message: 'a task offered from a map position must name the feature type it creates',
      });
    }
    checkSteps(t, ctx);
    // An automatic action without a timing is an edge: it fires when the shared `when` (and its own) turns true.
    for (const [name, entry] of Object.entries(t.auto ?? {})) {
      const timed = AUTO_TIMING_KINDS.keys.some(
        (k) => k !== 'edge' && (entry as Record<string, unknown>)[k] !== undefined,
      );
      if (!timed && entry.when === undefined && t.when === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['auto', name, 'when'],
          message:
            'an automatic action without a timing fires when the condition turns true: give the task a `when` (or the entry one)',
        });
    }
  })
  .describe('A task: a defined way to change features (on, bind, form, then).');
export type Task = z.infer<typeof TaskSchema>;
