/**
 * The detail page's data (v3 `instances/[id]/+page.svelte:60-240`): one `FeatureSheetInput` for both tabs, so Daten
 * and Aktivität format a value by the same function as the participant's feature sheet (`@ueberblick/ui` `formatProperty`).
 * Pure: the page hands in the row, the runs and the roster.
 */
import { actorName, type ActorLabels } from '../actor-names';
import {
  localize,
  shortId,
  SYSTEM_FIELD_SIGIL,
  type Json,
  type LocalizedString,
  type LifecycleState,
  type TemplateFile,
} from '@ueberblick/core';
import type { FeatureId, FeatureType, FoldedFeature, Key, RunId } from '@ueberblick/core/model';
import {
  buildActivity,
  buildFeatureSheetModel,
  type ActivityEntry,
  type ActivityView,
  type FeatureSheetInput,
  type FeatureSheetModel,
  type PropertyRow,
} from '@ueberblick/ui';
import type { HistoryRun } from '@ueberblick/server';

export type TypeDef = NonNullable<TemplateFile['types']>[string];
export type TaskDefs = NonNullable<TemplateFile['tasks']>;

/** A list row of the admin feature API (`$` system keys, `lon`/`lat`, the properties). */
export type ApiRow = Readonly<Record<string, Json | undefined>>;

export interface DetailInput {
  readonly typeKey: string;
  readonly type: TypeDef;
  readonly tasks: TaskDefs;
  readonly row: ApiRow;
  readonly runs: readonly HistoryRun[];
  /** Participant id to name (the roster). */
  readonly names: Readonly<Record<string, string>>;
  /** How the system and import actors read. */
  readonly actors: ActorLabels;
  /** Role key to its label: a `role` property shows the label (the same table the Daten page reads). */
  readonly roleLabels?: Readonly<Record<string, LocalizedString>>;
  /** Referenced feature id to its name (the server resolved it); an id without an entry shows as core `shortId`. */
  readonly featureLabels?: Readonly<Record<string, string>>;
  readonly locale: 'de' | 'en';
}

const sys = (key: string): string => `${SYSTEM_FIELD_SIGIL}${key}`;
const text = (v: Json | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

/** The api row as the folded feature the sheet functions read. */
export function foldedOf(input: DetailInput): FoldedFeature {
  const { row, type } = input;
  const properties: Record<string, Json> = {};
  for (const key of Object.keys(type.properties)) {
    const v = row[key];
    if (v !== undefined) properties[key] = v;
  }
  const createdBy = text(row[sys('created_by')]);
  const createdAt = text(row[sys('created_at')]);
  const changedAt = text(row[sys('changed_at')]);
  return {
    id: String(row[sys('id')]) as FeatureId,
    type: input.typeKey as Key,
    properties,
    lifecycle: String(row[sys('lifecycle')]) as LifecycleState,
    updatedSeq: 0,
    derived: {},
    ...(createdBy === undefined ? {} : { createdBy }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(changedAt === undefined ? {} : { changedAt }),
  } as FoldedFeature;
}

/** Who did a run: the one resolver's name (`actor-names.ts`), else the participant record's name, else the actor id. */
export function actorLabel(
  run: HistoryRun,
  names: Readonly<Record<string, string>>,
  actors: ActorLabels,
): string {
  const resolved = actorName(names, run.actor.id, actors);
  return resolved !== run.actor.id ? resolved : (run.actor.name ?? run.actor.id);
}

/** One run as the Aktivität entry the grouping reads: the task's label and the values the run wrote on this feature. */
export function entryOf(run: HistoryRun, input: DetailInput): ActivityEntry {
  const label = input.tasks[run.task]?.label;
  return {
    runId: run.id as RunId,
    task: label === undefined ? run.task : localize(label, [input.locale]) || run.task,
    actorLabel: actorLabel(run, input.names, input.actors),
    at: run.receivedAt,
    status: run.outcome === 'refused' ? 'refused' : 'accepted',
    changes: run.observations.map((o) => ({ property: o.property as Key, result: o.result })),
  };
}

export function sheetInputOf(input: DetailInput): FeatureSheetInput {
  return {
    feature: foldedOf(input),
    type: input.type as unknown as FeatureType,
    types: {},
    availableTasks: [],
    taskLabels: {},
    edgesOut: [],
    edgesIn: [],
    activity: input.runs.map((r) => entryOf(r, input)),
    lookups: {
      participant: (id) => input.names[id],
      role: (key) => {
        const label = input.roleLabels?.[key];
        return label === undefined ? undefined : localize(label, [input.locale]) || undefined;
      },
      feature: (id) => ({
        label: input.featureLabels?.[id] ?? shortId(id),
        type: '' as Key,
      }),
    },
    locale: input.locale,
  };
}

export interface DetailModel {
  readonly sheet: FeatureSheetModel;
  readonly activity: ActivityView;
  /** What the refused runs came to, by run id (the timeline's own run has no room for the reason). */
  readonly refusals: ReadonlyMap<string, string>;
  /** The lifecycle a run set, by run id (a lifecycle change is no property of the type). */
  readonly lifecycles: ReadonlyMap<string, string>;
}

export function buildDetail(input: DetailInput): DetailModel {
  const sheetInput = sheetInputOf(input);
  const refusals = new Map<string, string>();
  const lifecycles = new Map<string, string>();
  for (const run of input.runs) {
    if (run.refusal !== undefined) refusals.set(run.id, run.refusal.message);
    const set = run.observations.find((o) => o.property === sys('lifecycle'));
    if (typeof set?.result === 'string') lifecycles.set(run.id, set.result);
  }
  return {
    sheet: buildFeatureSheetModel(sheetInput),
    activity: buildActivity(sheetInput),
    refusals,
    lifecycles,
  };
}

export interface DataGroup {
  /** The tab name of the properties' `display.tab`, or null for the general group. */
  readonly name: string | null;
  readonly rows: readonly PropertyRow[];
}

/**
 * v3's Daten groups (`dataGroups`, `+page.svelte:94-115`): the properties in the Objektart's order, grouped by the tab
 * the admin gave them; the general group first, the others by `tab_order` then name. The stage and the location
 * are shown in the header and the Standort pane, not as rows.
 */
export function groupRows(
  rows: readonly PropertyRow[],
  type: TypeDef,
  locale: 'de' | 'en',
): readonly DataGroup[] {
  const stage = type.process?.property;
  const groups = new Map<string | null, { order: number; rows: PropertyRow[] }>();
  for (const row of rows) {
    if (row.key === stage || row.kind === 'geometry') continue;
    const display = type.properties[row.key]?.display;
    const name = display?.tab === undefined ? null : localize(display.tab, [locale]) || null;
    const group = groups.get(name) ?? { order: display?.tab_order ?? 0, rows: [] };
    group.order = Math.min(group.order, display?.tab_order ?? 0);
    group.rows.push(row);
    groups.set(name, group);
  }
  const collator = new Intl.Collator(locale);
  return [...groups]
    .sort(([an, a], [bn, b]) =>
      an === null ? -1 : bn === null ? 1 : a.order - b.order || collator.compare(an, bn),
    )
    .map(([name, g]) => ({ name, rows: g.rows }));
}
