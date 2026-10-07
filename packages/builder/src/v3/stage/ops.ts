/**
 * What the stage pane writes, as document ops (WP-335). A stage is an option of the type's process
 * property (A-028); its type (v3: start, intermediate, end) is `process.start` / `process.end`. Pure
 * functions of the effective file: the pane, the canvas node and an assistant (H4) share them (R1).
 */
import {
  formatKeyPath,
  processesOf,
  type LocalizedString,
  type Problem,
  type TemplateFile,
} from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { removeOp, slugKey } from '../../lenses/data-model/ops';
import { newTaskKey } from '../../lenses/process/edit';
import { problemItems, type ProblemItem } from '../../problems/model';

/** v3's stage types (`StageType`): where features begin, the steps between, where work ends. */
export const STAGE_TYPES = { start: 'start', intermediate: 'intermediate', end: 'end' } as const;
export type StageType = (typeof STAGE_TYPES)[keyof typeof STAGE_TYPES];

/** Why a type change was not made: the engine's process needs one start and at least one end. */
export const TYPE_REFUSALS = {
  noProcess: 'no_process',
  startNeeded: 'start_needed',
  endNeeded: 'end_needed',
} as const;
export type TypeRefusal = (typeof TYPE_REFUSALS)[keyof typeof TYPE_REFUSALS];

export type TypeResult =
  { readonly ok: true; readonly op: Op | undefined } | { readonly ok: false; readonly reason: TypeRefusal };

const processOf = (file: TemplateFile, type: string) => {
  const t = file.types?.[type];
  return t === undefined ? undefined : processesOf(t)[0];
};

export function stageTypeOf(file: TemplateFile, type: string, stage: string): StageType {
  const p = processOf(file, type);
  if (p?.start === stage) return STAGE_TYPES.start;
  return p?.end.includes(stage as never) === true ? STAGE_TYPES.end : STAGE_TYPES.intermediate;
}

/** The option's label; the key stays, so a rename never needs a value move on deploy. No op when the type has no process. */
function rename(
  file: TemplateFile,
  type: string,
  stage: string,
  locale: string,
  text: string,
): Op | undefined {
  const p = processOf(file, type);
  if (p === undefined) return undefined;
  const path = formatKeyPath(['types', type, 'properties', p.property, 'options', stage]);
  const current = file.types?.[type]?.properties[p.property]?.options?.[stage] as LocalizedString | undefined;
  const next =
    typeof current === 'object' && current !== null ? { ...current, [locale]: text } : { [locale]: text };
  return { kind: 'set', path, value: next };
}

function setType(file: TemplateFile, type: string, stage: string, next: StageType): TypeResult {
  const p = processOf(file, type);
  if (p === undefined) return { ok: false, reason: TYPE_REFUSALS.noProcess };
  const now = stageTypeOf(file, type, stage);
  if (now === next) return { ok: true, op: undefined };
  // The start is moved by choosing another start, never switched off.
  if (now === STAGE_TYPES.start) return { ok: false, reason: TYPE_REFUSALS.startNeeded };
  const others = p.end.filter((e) => e !== stage);
  const end = next === STAGE_TYPES.end ? [...others, stage] : others;
  if (end.length === 0) return { ok: false, reason: TYPE_REFUSALS.endNeeded };
  const start = next === STAGE_TYPES.start ? stage : p.start;
  return {
    ok: true,
    op: {
      kind: 'set',
      path: formatKeyPath(['types', type, 'process']),
      value: { property: p.property, start, end },
    },
  };
}

export type AddButtonResult =
  | { readonly ok: true; readonly op: Op; readonly key: string }
  | { readonly ok: false; readonly reason: typeof TYPE_REFUSALS.noProcess };

/** "Aktionsschaltfläche hinzufügen": a task on the Objektart, pinned to the stage by its `when`. */
function addButton(
  file: TemplateFile,
  type: string,
  stage: string,
  locale: string,
  name: string,
): AddButtonResult {
  const p = processOf(file, type);
  if (p === undefined) return { ok: false, reason: TYPE_REFUSALS.noProcess };
  const key = newTaskKey(file, name);
  return {
    ok: true,
    key,
    op: {
      kind: 'add',
      path: formatKeyPath(['tasks', key]),
      value: { label: { [locale]: name }, on: type, when: `self.${p.property} == '${stage}'` },
    },
  };
}

export const stageOps = { rename, setType, addButton };

/** The option key of a new stage, from its label. */
export const newStageKey = (file: TemplateFile, type: string, name: string): string => {
  const p = processOf(file, type);
  const taken = new Set(Object.keys(file.types?.[type]?.properties[p?.property ?? '']?.options ?? {}));
  return slugKey(name, taken);
};

export interface DeleteImpact {
  /** The document with the stage removed (not applied: the pane applies it on confirm). */
  readonly after: Doc;
  readonly op: Op;
  /** Problems the removal causes that the document did not have before. */
  readonly problems: readonly ProblemItem[];
}

const sig = (p: Pick<Problem, 'code' | 'path'>): string => `${p.code}@${p.path}`;

/** What deleting a stage would break, computed on a copy (a Doc is immutable); nothing when the type has no process. */
export function stageDeleteImpact(
  doc: Doc,
  type: string,
  stage: string,
  locale: string,
): DeleteImpact | undefined {
  const p = processOf(doc.effective(), type);
  if (p === undefined) return undefined;
  const path = formatKeyPath(['types', type, 'properties', p.property, 'options', stage]);
  const op = removeOp(doc, path);
  const after = doc.apply(op).doc;
  const had = new Set(doc.problems().map(sig));
  const fresh = new Set(
    after
      .problems()
      .filter((x) => !had.has(sig(x)))
      .map(sig),
  );
  return { after, op, problems: problemItems(after, locale).filter((i) => fresh.has(`${i.code}@${i.path}`)) };
}

/** Why the template refuses to change this stage (a probe rename on a copy); undefined when it is free. */
export function stageLock(doc: Doc, type: string, stage: string, locale: string): string | undefined {
  const file = doc.effective();
  const probe = rename(file, type, stage, locale, `${stage} `);
  return probe === undefined ? undefined : doc.apply(probe).refused?.message;
}
