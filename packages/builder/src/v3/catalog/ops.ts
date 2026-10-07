/**
 * What the catalog chips create, as document ops (WP-200): click or drag a chip, get the op that
 * adds the entity. Pure functions of the effective file; the chips, the canvas drop (S4-3) and an
 * assistant (H4) all end up in the same ops (R1). Keys come from the label (`slugKey`, A-005).
 */
import { allRolesWho, formatKeyPath, processesOf, type TemplateFile } from '@ueberblick/core';
import type { Op } from '../../doc';
import { slugKey } from '../../lenses/data-model/ops';
import { newTaskKey } from '../../lenses/process/edit';
import type { Selection } from '../shell/registry';
import { createRuleOps } from '../rule/ops';

/** The drag payload types (v3: `application/ueberblick-node`, `application/ueberblick-tool`). */
export const CATALOG_MIME = {
  node: 'application/ueberblick-node',
  task: 'application/ueberblick-tool',
} as const;

/** Struktur chips (v3: Phase, Eingang, Regel). A rule is made with its own task and v3's default trigger (WP-377). */
export const CATALOG_NODES = ['stage', 'entry', 'rule'] as const;
/** "Aufgabe hinzufügen" chips: a task without a form, and a task with one. */
export const CATALOG_TASKS = ['button', 'form'] as const;

export type CatalogCreate =
  | { readonly kind: 'node'; readonly node: (typeof CATALOG_NODES)[number] }
  | { readonly kind: 'task'; readonly task: (typeof CATALOG_TASKS)[number] };

/** The names a new entity starts with, already in the builder's language. */
export interface NewNames {
  readonly task: string;
  readonly entry: string;
  readonly stage: string;
  readonly rule: string;
  /** The label of the stage property a new process creates. */
  readonly process: string;
  /** The end stage a new process starts with (a process needs at least one). */
  readonly endStage: string;
}

export const CREATE_REFUSALS = { noProcess: 'no_process' } as const;
export type CreateRefusal = (typeof CREATE_REFUSALS)[keyof typeof CREATE_REFUSALS];

export type CreateResult =
  | {
      readonly ok: true;
      readonly op: Op;
      /** Ops applied after `op` (a rule is its task, then the rule). */
      readonly after?: readonly Op[];
      readonly select: Selection;
    }
  | { readonly ok: false; readonly reason: CreateRefusal };

/** The stage property of the type's process: where a new stage is added as an option. */
export function stagePropertyOf(file: TemplateFile, type: string): string | undefined {
  const t = file.types?.[type];
  return t === undefined ? undefined : processesOf(t)[0]?.property;
}

/**
 * A type without a process gets one (v3: every workflow could add stages): the stage `select` property
 * (`stage`, as in the golden templates) with the new stage as start and one end stage, then `process`.
 * Applied together (`after`), so it is one undoable change.
 */
function newProcess(file: TemplateFile, type: string, locale: string, names: NewNames): CreateResult {
  const t = file.types?.[type];
  const property = slugKey('stage', new Set(Object.keys(t?.properties ?? {})));
  const start = slugKey(names.stage, new Set());
  const end = slugKey(names.endStage, new Set([start]));
  return {
    ok: true,
    op: {
      kind: 'add',
      path: formatKeyPath(['types', type, 'properties', property]),
      value: {
        type: 'select',
        label: { [locale]: names.process },
        options: { [start]: { [locale]: names.stage }, [end]: { [locale]: names.endStage } },
      },
    },
    after: [
      {
        kind: 'add',
        path: formatKeyPath(['types', type, 'process']),
        value: { property, start, end: [end] },
      },
    ],
    select: { kind: 'stage', id: start },
  };
}

export function createOp(
  file: TemplateFile,
  type: string,
  req: CatalogCreate,
  locale: string,
  names: NewNames,
): CreateResult {
  if (req.kind === 'node' && req.node === 'stage') {
    const t = file.types?.[type];
    if (t === undefined) return { ok: false, reason: CREATE_REFUSALS.noProcess };
    const property = stagePropertyOf(file, type);
    if (property === undefined) return newProcess(file, type, locale, names);
    const taken = new Set(Object.keys(t.properties[property]?.options ?? {}));
    const key = slugKey(names.stage, taken);
    return {
      ok: true,
      op: {
        kind: 'add',
        path: formatKeyPath(['types', type, 'properties', property, 'options', key]),
        value: { [locale]: names.stage },
      },
      select: { kind: 'stage', id: key },
    };
  }
  if (req.kind === 'node' && req.node === 'rule') {
    const made = createRuleOps(file, { type, stage: stagePropertyOf(file, type) }, locale, {
      rule: names.rule,
    });
    return { ok: true, op: made.ops[0] as Op, after: made.ops.slice(1), select: made.select };
  }
  const entry = req.kind === 'node';
  const name = entry ? names.entry : names.task;
  const key = newTaskKey(file, name);
  const label = { [locale]: name };
  // A new person action and a new entry are open to all roles plus admin (v3: empty role list = everyone); the Wer chips narrow it.
  const who = allRolesWho(file);
  const value = entry
    ? { label, on: '$map', creates: type, who }
    : req.kind === 'task' && req.task === 'form'
      ? { label, on: type, who, form: {} }
      : { label, on: type, who };
  return {
    ok: true,
    op: { kind: 'add', path: formatKeyPath(['tasks', key]), value },
    select: { kind: 'task', id: key },
  };
}
