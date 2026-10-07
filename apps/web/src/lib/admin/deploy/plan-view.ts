/**
 * The deploy overview's plan (WP-360): what `plan` (the engine's dry run) and `Doc.problems()` say about the saved draft,
 * grouped per Objektart in plain words. It only arranges; every number comes from the engine (R1): the diff entries are
 * `core.diff` with `affected`, the choices are the `versions` counts of WP-317, the targets come from `buildPlan`.
 */
import {
  formatKeyPath,
  localize,
  parseKeyPath,
  type LocalizedString,
  type TemplateFile,
} from '@ueberblick/core';
import { changedTypes, type PlannedChange, type VersionPlan } from '@ueberblick/server';
import { entitySegments, orderTargetOf } from './entity-path';
import type { Blocker, MappingView, PlanEntry, PlanGroup } from './types';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function valueAt(file: unknown, segments: readonly string[]): unknown {
  let cur: unknown = file;
  for (const s of segments) {
    if (!isObj(cur)) return undefined;
    cur = cur[s];
  }
  return cur;
}

/** One breaking entry and the replacements the admin may choose (the builder's `buildPlan` says which; structural here). */
export interface MappingRequirement {
  readonly path: string;
  readonly choices: readonly string[];
}

/** The part of a builder problem the deploy overview shows as a blocker. */
export interface BlockerSource {
  readonly id: string;
  readonly path: string;
  readonly message: string;
  readonly location: { readonly type?: string | undefined };
}

export interface PlanInput {
  /** The running config version's effective file; `undefined` before the first deploy. */
  readonly before: TemplateFile | undefined;
  readonly after: TemplateFile;
  readonly diff: readonly PlannedChange[];
  readonly versions: readonly VersionPlan[];
  /** `buildPlan(...).affected` (the builder stays out of `lib/`): the Objektarten that touch Objekte, with their count. A reorder-only type is not in it. */
  readonly affected: readonly { readonly type: string; readonly features: number }[];
  readonly locale: string;
}

/** An option is a label itself (`options: { a: Anfang }`), every other element has a `label` key. */
const isOption = (segments: readonly string[]): boolean =>
  segments[0] === 'types' &&
  segments[2] === 'properties' &&
  segments[4] === 'options' &&
  segments.length === 6;

/** The label of the element at `segments` (in the new file, else the old one), or its key. */
function nameAt(input: PlanInput, segments: readonly string[]): string {
  const last = segments[segments.length - 1] ?? '';
  const where = isOption(segments) ? segments : [...segments, 'label'];
  for (const file of [input.after, input.before]) {
    const text = localize(valueAt(file, where) as LocalizedString | undefined, [input.locale]);
    if (text !== '') return text;
  }
  return last;
}

/** An option of the Objektart's process property is a stage. */
function isStage(input: PlanInput, segments: readonly string[]): boolean {
  const [section, type, kind, property, sub] = segments;
  if (section !== 'types' || type === undefined || kind !== 'properties' || sub !== 'options') return false;
  const file = input.after.types?.[type] !== undefined ? input.after : input.before;
  return file?.types?.[type]?.process?.property === property;
}

/**
 * The entries of one element as one line: the element itself added or removed, else "geändert". A deeper key
 * (`types.baum.label.de`) is a change of its element, so several edits of one task read as one line.
 */
function linesOf(input: PlanInput, entries: readonly PlannedChange[]): PlanEntry[] {
  const orders = entries.filter((e) => e.change === 'order_changed').map((e) => orderLine(input, e));
  return [
    ...entityLines(
      input,
      entries.filter((e) => e.change !== 'order_changed'),
    ),
    ...orders,
  ];
}

/** A reordered map is one line that names the element owning it (WP-414), not the map's last key. */
function orderLine(input: PlanInput, e: PlannedChange): PlanEntry {
  const segments = parseKeyPath(e.path) ?? [e.path];
  const order = orderTargetOf(segments);
  const owner = order?.owner == null ? undefined : parseKeyPath(order.owner);
  return {
    path: e.path,
    change: 'order_changed',
    breaking: false,
    name: owner === undefined ? (segments.at(-1) ?? e.path) : nameAt(input, owner),
    ...(order === undefined ? {} : { order }),
  };
}

function entityLines(input: PlanInput, entries: readonly PlannedChange[]): PlanEntry[] {
  const byEntity = new Map<
    string,
    { segments: readonly string[]; own?: PlannedChange; all: PlannedChange[] }
  >();
  for (const e of entries) {
    const segments = parseKeyPath(e.path) ?? [e.path];
    const entity = entitySegments(segments);
    const key = formatKeyPath(entity);
    const slot = byEntity.get(key) ?? { segments: entity, all: [] };
    slot.all.push(e);
    if (entity.length === segments.length) slot.own = e;
    byEntity.set(key, slot);
  }
  return [...byEntity].map(([path, { segments, own, all }]) => {
    const affected = Math.max(0, ...all.map((e) => e.affected ?? 0));
    const change = own !== undefined && own.change !== 'changed' ? own.change : 'changed';
    const parts = change === 'changed' ? partsOf(segments, all) : [];
    return {
      path,
      change,
      breaking: all.some((e) => e.breaking),
      ...(all.some((e) => e.affected !== undefined) ? { affected } : {}),
      name: nameAt(input, segments),
      ...(isStage(input, segments) ? { stage: true as const } : {}),
      ...(parts.length > 0 ? { parts } : {}),
    };
  });
}

/**
 * What of a changed element changed (WP-506): the first key below it (`label`, `when`, `button`), and for a task's form
 * the entry (`form.a`), so a task whose form changed says which entries. Sorted; none for an element added or removed.
 */
function partsOf(entity: readonly string[], all: readonly PlannedChange[]): readonly string[] {
  const parts = new Set<string>();
  for (const e of all) {
    const rest = (parseKeyPath(e.path) ?? []).slice(entity.length);
    const head = rest[0];
    if (head === undefined) continue;
    parts.add(head === 'form' && rest[1] !== undefined ? `form.${rest[1]}` : head);
  }
  return [...parts].sort();
}

/** The Objektarten an entry belongs to: its own, or those of the task or rule it changes. */
const typesOf = (input: PlanInput, e: PlannedChange): readonly string[] => [
  ...changedTypes(input.before, input.after, [e], { withOrder: true }),
];

/** One group per Objektart that changed (new ones first listed by the file's order), then the project-level one. */
export function groupsOf(input: PlanInput): readonly PlanGroup[] {
  const order = [
    ...new Set([...Object.keys(input.after.types ?? {}), ...Object.keys(input.before?.types ?? {})]),
  ];
  const byType = new Map<string, PlannedChange[]>();
  const rest: PlannedChange[] = [];
  const created = new Set<string>();
  const removed = new Set<string>();
  for (const e of input.diff) {
    const segments = parseKeyPath(e.path) ?? [];
    if (segments.length === 2 && segments[0] === 'types' && segments[1] !== undefined) {
      if (e.change === 'added') created.add(segments[1]);
      if (e.change === 'removed') removed.add(segments[1]);
    }
    const types = typesOf(input, e);
    if (types.length === 0) rest.push(e);
    else for (const t of types) byType.set(t, [...(byType.get(t) ?? []), e]);
  }
  const first = input.before === undefined;
  const groups: PlanGroup[] = order
    .filter((t) => byType.has(t) || first)
    .map((t) => ({
      type: t,
      label:
        localize((input.after.types?.[t] ?? input.before?.types?.[t])?.label as LocalizedString | undefined, [
          input.locale,
        ]) || t,
      isNew: first || created.has(t),
      isRemoved: removed.has(t),
      objects: input.affected.find((a) => a.type === t)?.features ?? 0,
      // A new Objektart is one badge, not a list of everything it has (as v3).
      entries: first || created.has(t) ? [] : linesOf(input, byType.get(t) ?? []),
    }));
  return first || rest.length === 0
    ? groups
    : [
        ...groups,
        { type: null, label: '', isNew: false, isRemoved: false, objects: 0, entries: linesOf(input, rest) },
      ];
}

/** The breaking entries with the targets their values may move to (the caller passes `buildPlan`'s requirements) and their counts. */
export function mappingsOf(
  input: PlanInput,
  requirements: readonly MappingRequirement[],
): readonly MappingView[] {
  const affected = new Map(input.diff.map((e) => [e.path, e.affected ?? 0]));
  const breaking = new Map(input.diff.filter((e) => e.breaking).map((e) => [e.path, e]));
  return requirements.flatMap((req): MappingView[] => {
    const entry = breaking.get(req.path);
    if (entry === undefined) return [];
    const segments = parseKeyPath(req.path) ?? [req.path];
    const parent = segments.slice(0, -1);
    return [
      {
        path: req.path,
        name: nameAt(input, entitySegments(segments)),
        type: typesOf(input, entry)[0] ?? null,
        stage: isStage(input, segments),
        affected: affected.get(req.path) ?? 0,
        choices: req.choices.map((key) => ({ key, label: nameAt(input, [...parent, key]) })),
      },
    ];
  });
}

export const blockersOf = (items: readonly BlockerSource[]): readonly Blocker[] =>
  items.map((p) => ({ id: p.id, path: p.path, message: p.message, type: p.location.type ?? null }));
