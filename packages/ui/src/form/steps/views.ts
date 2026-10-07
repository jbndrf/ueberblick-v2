import { stepsOf } from '@ueberblick/core/form';
import type { Key, Property, Task } from '@ueberblick/core/model';
import type { BuildFormInput, Json, SessionOptions } from '../contract';
import { localize } from '../localize';
import { buildFormModel } from '../model';
import { createFormSession } from '../session';
import type { StepView } from './contract';

export interface BuildStepViewsInput {
  readonly task: Key;
  /** The task definition: its `steps` (or just its `form`) decide the views, in order. */
  readonly def: Pick<Task, 'form' | 'steps'>;
  /** The properties of the feature type the task works on. */
  readonly properties: Readonly<Record<string, Property>>;
  readonly config: SessionOptions['config'];
  readonly ctx: SessionOptions['ctx'];
  readonly type?: SessionOptions['type'];
  /** The Objektarten of the bind fields of the form (`<bind>.<property>`, A-047), as `buildFormModel` takes them. */
  readonly bound?: BuildFormInput['bound'];
  readonly locale?: string;
  /** Values of the feature now: they open a quick-edit step and tell where the shape is. */
  readonly current: Readonly<Record<string, Json>>;
  /** Prefill of the form step. */
  readonly initial?: Readonly<Record<string, Json>>;
}

/**
 * The views of a task's steps. The form step shows only the fields of the task `form`; a quick-edit step shows only
 * the properties the admin picked, opened on their current values; a location step names its geometry property.
 * Every rule (relevance, required, constraint) is still `core.form` through the session (R1).
 */
export function buildStepViews(i: BuildStepViewsInput): StepView[] {
  const base = {
    task: i.task,
    config: i.config,
    ctx: i.ctx,
    ...(i.type === undefined ? {} : { type: i.type }),
    ...(i.locale === undefined ? {} : { locale: i.locale }),
  };
  const model = (form: BuildFormInput['form'], placed?: BuildFormInput['placed']) =>
    buildFormModel({
      form,
      properties: i.properties,
      ...(i.bound === undefined ? {} : { bound: i.bound }),
      ...(placed === undefined ? {} : { placed }),
    });
  return stepsOf(i.def).map((step): StepView => {
    if (step.kind === 'form')
      return {
        kind: 'form',
        session: createFormSession(model(i.def.form ?? {}, i.initial), { ...base, initial: i.initial ?? {} }),
      };
    if (step.kind === 'quick_edit') {
      const picked = Object.fromEntries(step.properties.map((k) => [k, {}]));
      const initial = Object.fromEntries(
        step.properties.flatMap((k): [string, Json][] =>
          i.current[k] === undefined ? [] : [[k, i.current[k]]],
        ),
      );
      return { kind: 'quick_edit', session: createFormSession(model(picked), { ...base, initial }) };
    }
    const property = i.properties[step.property];
    const current = i.current[step.property];
    return {
      kind: 'location',
      property: step.property as Key,
      label: localize(property?.label ?? step.property, i.locale ?? 'en'),
      ...(current === undefined ? {} : { current }),
    };
  });
}
