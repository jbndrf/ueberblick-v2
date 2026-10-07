/**
 * Plans one run: availability (scope), the form (core.form), the observations of the form and of
 * `then`, then the rules the run triggers (rules.ts, depth-first). All writes go through the
 * overlay, so later steps and rule runs read them (docs/03 "life of a run").
 */
import type { EvalValue } from '../expr/contract';
import type { FormEvaluation } from '../form/contract';
import { isEmptyValue } from '../form/empty';
import { sameJson } from '../form';
import type { FeatureId, Json, Key, Observation, Refusal, Run } from '../model';
import type { FormFieldIssue } from '../registry';
import type { RefusalCode } from '../registry/refusals';
import { RESERVED_CREATED_BY, creatorOf } from '../fold/audit';
import { SYSTEM_FIELD_SIGIL } from '../registry/system-fields';
import { localize } from '../locale';
import { processesOf } from '../process';
import type { LocalizedString } from '../schema';
import type { Task } from '../schema/task';
import { stepProperties, stepsOf } from '../schema/steps-of';
import { taskTypes } from '../schema/compile/indexes';
import { recomputeAfter } from './computed';
import type { PlannedRun } from './contract';
import type { Change } from './overlay';
import { checkQuota, recordCreated } from './quota';
import { fireRules } from './rules';
import { envAt } from './resolve';
import { participantRefusal } from './participant-choice';
import { roleRefusal } from './role-choice';
import { claimId, isBound, refuse, scope, targetOf, type Env } from './scope';
import { denyWrites, runSteps, toJson } from './steps';

export type RunOutcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };

const FORM_REFUSALS: Readonly<Record<FormFieldIssue, RefusalCode>> = {
  required: 'required_missing',
  constraint: 'constraint_failed',
  type: 'invalid_input',
  option: 'invalid_input',
  readonly: 'readonly_field',
};

const text = (s: LocalizedString | undefined): string | undefined =>
  s === undefined ? undefined : localize(s, []);

/** The first failing relevant field of the form, as a refusal. */
function formRefusal(ev: FormEvaluation): Refusal | undefined {
  for (const f of ev.fields) {
    const first = f.relevant ? f.issues[0] : undefined;
    if (first === undefined) continue;
    const message = text(first.message) ?? first.error?.message ?? `field '${f.key}': ${first.issue}`;
    // A required geometry has its own refusal (docs/05): the ui asks for a position, not for a value.
    const code =
      first.issue === 'required' && f.propertyType === 'geometry'
        ? 'geometry_required'
        : FORM_REFUSALS[first.issue];
    return refuse(code, message, `form.${f.key}`);
  }
  return undefined;
}

/** Input keys that are no field of the form: `bind.property` outside the binds, or an unknown field. */
function unknownInput(env: Env, run: Run): Refusal | undefined {
  const task = env.config.file.tasks?.[run.task];
  for (const key of Object.keys(run.input)) {
    // A system key (`$version`, `$lifecycle`, ...) is never a form value: only system tasks write one (A-029).
    if (key.startsWith(SYSTEM_FIELD_SIGIL))
      return refuse(
        'not_permitted',
        `'${key}' is a system key; a run input may not write it`,
        `input.${key}`,
      );
    // A computed property may be listed in the form (display only, WP-804); plan alone writes it.
    const types = task === undefined ? [] : task.creates !== undefined ? [task.creates] : taskTypes(task);
    if (types.some((t) => env.config.file.types?.[t]?.properties[key]?.computed !== undefined))
      return refuse('invalid_input', `'${key}' is computed; a run input may not write it`, `input.${key}`);
    if (task?.form !== undefined && Object.hasOwn(task.form, key)) continue;
    if (task !== undefined && stepProperties(task).includes(key)) continue;
    const dot = key.indexOf('.');
    if (dot >= 0 && !(task?.bind !== undefined && Object.hasOwn(task.bind, key.slice(0, dot)))) {
      return refuse(
        'bind_undeclared',
        `'${key}' addresses a feature outside the binds of '${run.task}'`,
        `input.${key}`,
      );
    }
    return refuse('invalid_input', `'${key}' is not a field of '${run.task}'`, `input.${key}`);
  }
  return undefined;
}

/** An automatic run carries no input: its values are the task's `then.set`. */
function noFormInput(run: Run): Refusal | undefined {
  const key = Object.keys(run.input)[0];
  return key === undefined
    ? undefined
    : refuse(
        'invalid_input',
        `'${key}': an automatic run has no form; its values come from the task's \`then.set\``,
        `input.${key}`,
      );
}

/**
 * A quick-edit value or a location-step geometry that equals the current one writes nothing; an emptied one clears the property with an
 * explicit null (v3 dropped empty values, so a value could never be cleared).
 */
function quickEdits(env: Env, task: Task, id: FeatureId, form: Record<string, Json>): void {
  const current = env.overlay.feature(id)?.properties ?? {};
  for (const step of stepsOf(task)) {
    if (step.kind === 'location') {
      // a geometry equal to the stored one writes nothing; an emptied one is no location, so it is not cleared here
      if (Object.hasOwn(form, step.property) && sameJson(form[step.property], current[step.property]))
        Reflect.deleteProperty(form, step.property);
      continue;
    }
    if (step.kind !== 'quick_edit') continue;
    for (const key of step.properties) {
      if (!Object.hasOwn(form, key)) continue;
      if (sameJson(form[key], current[key])) Reflect.deleteProperty(form, key);
      else if (isEmptyValue(form[key])) form[key] = null;
    }
  }
}

/**
 * The writes of the form's `<bind>.<property>` fields: one observation each on the bound Objekt. A read-only field and a
 * value equal to the current one write nothing (the prefill must not turn into noise); an emptied one clears the property.
 */
function bindWrites(
  env: Env,
  ev: FormEvaluation,
  vars: ReadonlyMap<string, EvalValue>,
  form: Record<string, Json>,
  run: Run,
): readonly { readonly key: string; readonly observation: Observation }[] {
  const out: { key: string; observation: Observation }[] = [];
  for (const f of ev.fields) {
    if (f.bind === undefined || f.readonly || !Object.hasOwn(form, f.key)) continue;
    const id = toJson(vars.get(f.bind.name) ?? null) as FeatureId | null;
    if (id === null) continue;
    const property = f.key.slice(f.key.indexOf('.') + 1);
    const value = form[f.key] as Json;
    const current = env.overlay.feature(id)?.properties[property];
    if (sameJson(value, current)) continue;
    out.push({
      key: f.key,
      observation: {
        featureId: id,
        property,
        result: isEmptyValue(value) ? null : value,
        ...(run.clientTime !== undefined ? { phenomenonTime: run.clientTime } : {}),
      },
    });
  }
  return out;
}

const stamp = (run: Run): { phenomenonTime?: string } =>
  run.clientTime === undefined ? {} : { phenomenonTime: run.clientTime };

export function planRun(base: Env, submitted: Run, depth: number): RunOutcome {
  // The run is planned under its target feature's version; a create floats on the deployed one (A-029 §2).
  const env = envAt(base, submitted.featureId);
  // L1: a run planned elsewhere under another version than the feature's is replanned under the feature's.
  const run: Run =
    env.version === undefined || env.version === submitted.configVersion
      ? submitted
      : { ...submitted, configVersion: env.version };
  const declared = env.config.file.tasks?.[run.task];
  if (declared === undefined) return { ok: false, refusal: refuse('unknown_task', `no task '${run.task}'`) };
  const s = scope(env, run.task, targetOf(declared, run), run.actor, run.auto);
  if (!s.ok) return { ok: false, refusal: s.refusal };
  const { task, self } = s;

  // An automatic run (a system actor) has no form: its values come from `then.set` (C-004); a person's run is checked.
  const automatic = run.actor.kind === 'system';
  const unknown = automatic ? noFormInput(run) : unknownInput(env, run);
  if (unknown !== undefined) return { ok: false, refusal: unknown };
  let evaluation: FormEvaluation | undefined;
  let form: Record<string, Json> = {};
  if (!automatic) {
    // Omitted fields with a `calculate` are filled from the current state; the input overrides (golden: odk/calculate_prefill).
    const values = env.form.initial(run.task, env.config, s.ctx, run.input);
    evaluation = env.form.evaluate(run.task, env.config, values, s.ctx);
    const rejected = formRefusal(evaluation);
    if (rejected !== undefined) return { ok: false, refusal: rejected };
    form = { ...env.form.submitValues(evaluation) };
  }

  const creates = task.creates as Key | undefined;
  const newId: FeatureId | undefined =
    creates === undefined
      ? undefined
      : task.on === '$map' && run.featureId !== undefined
        ? run.featureId
        : env.ids.featureId();
  const subject =
    newId !== undefined && creates !== undefined
      ? { id: newId, type: creates }
      : self === undefined
        ? undefined
        : { id: self.id, type: self.type };
  const created = newId !== undefined;
  if (newId !== undefined) {
    const taken = claimId(env, newId, 'featureId');
    if (taken !== undefined) return { ok: false, refusal: taken };
  }
  if (subject !== undefined && !created) {
    quickEdits(env, task, subject.id, form);
    // Q5: a stored field that the values hide is cleared when the participant confirmed it (an explicit null).
    const stored = env.overlay.feature(subject.id)?.properties ?? {};
    if (evaluation !== undefined)
      for (const key of env.form.hiddenClears(evaluation, run.input))
        if (!isEmptyValue(stored[key])) form[key] = null;
  }

  // `<bind>.<property>` fields write to the bound Objekt (A-047); the rest of `form` is the subject's.
  const bound = evaluation === undefined ? [] : bindWrites(env, evaluation, s.vars, form, run);
  const own = Object.fromEntries(Object.entries(form).filter(([k]) => !k.includes('.')));

  const initial: Observation[] = [];
  if (subject !== undefined) {
    if (created) {
      if (isBound(run.actor)) {
        const allowed = env.perms.forType(subject.type)?.canCreate(env.perms.subjects(run.actor));
        if (allowed === undefined || !allowed.ok)
          return {
            ok: false,
            refusal: refuse(
              'not_permitted',
              `the actor may not create ${subject.type}`,
              'permissions.create',
            ),
          };
        const over = checkQuota(env, run.actor);
        if (over !== undefined) return { ok: false, refusal: over };
        recordCreated(env, run.actor);
      }
      initial.push({ featureId: subject.id, property: '$type', result: subject.type, ...stamp(run) });
      initial.push({
        featureId: subject.id,
        property: RESERVED_CREATED_BY,
        result: creatorOf(run),
        ...stamp(run),
      });
      const subjectType = env.config.file.types?.[subject.type];
      for (const [key, p] of Object.entries(subjectType?.properties ?? {})) {
        if (p.default !== undefined && own[key] === undefined) {
          initial.push({ featureId: subject.id, property: key, result: p.default, ...stamp(run) });
        }
      }
      // A new feature starts in the process `start`; a `then.set` of the creating task comes later and wins.
      for (const proc of subjectType === undefined ? [] : processesOf(subjectType)) {
        initial.push({ featureId: subject.id, property: proc.property, result: proc.start, ...stamp(run) });
      }
    }
    for (const [property, result] of Object.entries(own)) {
      if (result !== undefined) initial.push({ featureId: subject.id, property, result, ...stamp(run) });
    }
  } else if (Object.keys(own).length > 0) {
    return {
      ok: false,
      refusal: refuse('invalid_input', `task '${run.task}' has no feature to write to`, 'form'),
    };
  }
  const input = {
    env,
    run,
    task,
    subject,
    vars: s.vars,
    form: form as { readonly [f: string]: Json },
    created,
  };
  const denied = denyWrites(input, initial);
  if (denied !== undefined) return { ok: false, refusal: denied };
  // Same permission check as a `then.set` on a bound feature; the refusal names the form field.
  for (const w of bound) {
    const d = denyWrites(input, [w.observation]);
    if (d !== undefined) return { ok: false, refusal: { ...d, path: `form.${w.key}` } };
  }
  const boundObs = bound.map((w) => w.observation);
  const chosen = participantRefusal(env, run, subject && env.config.file.types?.[subject.type], form);
  if (chosen !== undefined) return { ok: false, refusal: chosen };
  const roleChosen = roleRefusal(
    env.config.file.roles,
    subject && env.config.file.types?.[subject.type],
    run,
    form,
  );
  if (roleChosen !== undefined) return { ok: false, refusal: roleChosen };
  const changes: Change[] = [...env.overlay.apply(run.id, [...initial, ...boundObs])];

  const steps = runSteps(input);
  if (!steps.ok) return { ok: false, refusal: steps.refusal };
  changes.push(...steps.changes);

  // Computed properties follow the run's own writes, in the same run (WP-312); rules below see their values.
  const computed = recomputeAfter(
    env,
    run,
    [...initial, ...boundObs, ...steps.observations],
    created ? subject?.id : undefined,
  );
  changes.push(...computed.changes);

  if (created && subject !== undefined) {
    const missing = requiredMissing(env, subject);
    if (missing !== undefined) return { ok: false, refusal: missing };
  }

  const planned: PlannedRun = {
    run,
    observations: [...initial, ...boundObs, ...steps.observations, ...computed.observations],
    created: created && subject !== undefined ? [subject.id] : [],
    purge: steps.purge,
    erased: steps.erased,
  };
  const chain = fireRules(
    env,
    {
      run,
      task: run.task,
      subject: subject?.id,
      form,
      changes,
      created: planned.created,
      depth,
    },
    planRun,
  );
  if (!chain.ok) return chain;
  return { ok: true, runs: [planned, ...chain.runs] };
}

/** A created feature must have every property its type marks `required`, after defaults and `then`. */
export function requiredMissing(
  env: Env,
  subject: { readonly id: FeatureId; readonly type: Key },
): Refusal | undefined {
  const props = env.overlay.feature(subject.id)?.properties ?? {};
  for (const [key, p] of Object.entries(env.config.file.types?.[subject.type]?.properties ?? {})) {
    if (p.required === true && isEmptyValue(props[key])) {
      const code: RefusalCode = p.type === 'geometry' ? 'geometry_required' : 'required_missing';
      return refuse(code, `'${key}' is required for a new ${subject.type}`, `properties.${key}`);
    }
  }
  return undefined;
}
