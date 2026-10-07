/**
 * The action pane's edits of an automatic action as Doc ops (R1: the pane, tests and an assistant, H2 dispatch and
 * H4, write through these). An automatic action is the entry `tasks.<task>.auto.<name>` (`AutoEntrySchema`: label,
 * one timing, `when`, `with`); v3's automation steps are the `then` (glossary-lint-ignore) steps of the task it
 * belongs to (lead-a decision 1 of WP-377), edited by the task pane's Ergebnisse list. Pure like the other builder
 * `ops` modules. `rule` below is the automatic action id, `<task>.<name>`.
 */
import { formatKeyPath, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { slugKey } from '../../lenses/data-model/ops';
import { clearOps, setOps, withLocalized } from '../../lenses/task/edit';
import { newTaskKey } from '../../lenses/process/edit';
import type { Selection } from '../shell/registry';
import { autoAt, autoOf, ownsTask } from './auto-task';
import {
  AUTO_TIMING_KEYS,
  readRule,
  startTrigger,
  writeTrigger,
  type Trigger,
  type TriggerEnv,
} from './trigger';
import { cutTaskOrder } from '../task/ops';
import { compose } from '../task/when';

function setWhen(doc: Doc, rule: string, source: string | undefined): readonly Op[] {
  const path = `${autoAt(rule)}.when`;
  if (source === undefined || source.trim() === '') {
    return autoOf(doc.effective(), rule)?.entry.when === undefined ? [] : clearOps(doc, path);
  }
  return setOps(doc, path, source.trim());
}

/**
 * The timing keys of the entry replaced by `timing`: the new ones are set and the ones it lacks taken out. Each op is
 * checked against the file schema, which wants a timing or a `when` at every step, so the sets come first.
 */
function timingOps(
  doc: Doc,
  rule: string,
  timing: Readonly<Record<string, unknown>>,
): { readonly sets: readonly Op[]; readonly clears: readonly Op[] } {
  const entry = autoOf(doc.effective(), rule)?.entry as Readonly<Record<string, unknown>> | undefined;
  if (entry === undefined) return { sets: [], clears: [] };
  const sets: Op[] = [];
  const clears: Op[] = [];
  for (const key of AUTO_TIMING_KEYS) {
    const path = `${autoAt(rule)}.${key}`;
    if (timing[key] === undefined) {
      if (entry[key] !== undefined) clears.push(...clearOps(doc, path));
    } else if (JSON.stringify(entry[key]) !== JSON.stringify(timing[key]))
      sets.push(...setOps(doc, path, timing[key]));
  }
  return { sets, clears };
}

/** The timing replaced; the rows of its Bedingung stay (an edge timing takes them into its one condition). Undefined: it cannot be written here. */
export function triggerOps(doc: Doc, rule: string, tr: Trigger, env: TriggerEnv): readonly Op[] | undefined {
  const file = doc.effective();
  const auto = autoOf(file, rule);
  const written = writeTrigger(tr, env);
  if (auto === undefined || written === undefined) return undefined;
  const rest = readRule(file, auto.entry, env).rest;
  const rows = rest === undefined ? [] : [rest];
  const when = compose(written.edge === undefined ? [...written.leaves, ...rows] : [written.edge, ...rows]);
  const timing = timingOps(doc, rule, written.timing);
  return [...timing.sets, ...setWhen(doc, rule, when), ...timing.clears];
}

/** The Bedingung rows replaced by `source` (empty: none); the picker's own `when` parts stay. An edge timing has no rows. */
export function conditionOps(doc: Doc, rule: string, source: string, env: TriggerEnv): readonly Op[] {
  const file = doc.effective();
  const auto = autoOf(file, rule);
  if (auto === undefined) return [];
  const reading = readRule(file, auto.entry, env);
  if (reading.trigger?.kind === 'when') return [];
  const written = reading.trigger === undefined ? undefined : writeTrigger(reading.trigger, env);
  const text = source.trim();
  return setWhen(doc, rule, compose([...(written?.leaves ?? []), ...(text === '' ? [] : [text])]));
}

/** The action's name in `locale`; an action with its own task carries the same name on the task. Empty text changes nothing. */
export function labelOps(doc: Doc, rule: string, locale: string, text: string): readonly Op[] {
  if (text.trim() === '') return [];
  const file = doc.effective();
  const auto = autoOf(file, rule);
  const value = withLocalized(auto?.entry.label, locale, text);
  if (auto === undefined || value === undefined) return [];
  const task = ownsTask(file, rule) ? file.tasks?.[auto.task] : undefined;
  const own = task === undefined ? undefined : withLocalized(task.label, locale, text);
  return [
    ...setOps(doc, `${autoAt(rule)}.label`, value),
    ...(own === undefined ? [] : setOps(doc, `tasks.${auto.task}.label`, own)),
  ];
}

/** Takes the action out; the task it owns goes with it (the entry lives inside it, and a task only it ran would be left unreachable). */
export function deleteOps(doc: Doc, rule: string): readonly Op[] {
  const file = doc.effective();
  const auto = autoOf(file, rule);
  if (auto === undefined) return [];
  if (!ownsTask(file, rule)) return clearOps(doc, autoAt(rule));
  return [...cutTaskOrder(doc, [auto.task]), ...clearOps(doc, `tasks.${auto.task}`)];
}

export interface NewRuleNames {
  readonly rule: string;
}

export interface CreatedRule {
  /** The task with its one automatic action: one op. */
  readonly ops: readonly Op[];
  readonly select: Selection;
}

/** The timing a new action starts with: v3's `on_create` (the type's entry), else any change of the type. */
export function defaultTrigger(file: TemplateFile, env: TriggerEnv): Trigger {
  return startTrigger('create', file, env) ?? { kind: 'change', properties: [], stage: '' };
}

/**
 * "Aktion hinzufügen → Automatisch": a task only the system can run (offered on the type, no `who`) carrying one automatic action with v3's default timing, named after the action. It has no steps yet.
 */
export function createRuleOps(
  file: TemplateFile,
  env: TriggerEnv,
  locale: string,
  names: NewRuleNames,
): CreatedRule {
  const lang = locale.split('-')[0] ?? locale;
  const label = { [lang]: names.rule };
  const taskKey = newTaskKey(file, names.rule);
  const name = slugKey(names.rule, new Set());
  const written = writeTrigger(defaultTrigger(file, env), env);
  if (written === undefined) throw new Error('the default trigger can always be written');
  const entry = { label, ...written.timing, ...(written.edge === undefined ? {} : { when: written.edge }) };
  return {
    ops: [
      {
        kind: 'add',
        path: formatKeyPath(['tasks', taskKey]),
        value: { label, on: env.type, auto: { [name]: entry } },
      },
    ],
    select: { kind: 'rule', id: `${taskKey}.${name}` },
  };
}
