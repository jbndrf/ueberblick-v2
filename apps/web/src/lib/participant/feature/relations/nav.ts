/**
 * The relation navigation of the feature sheet (v3 `relation-graph.ts`, `RelationNav` in `types.ts`): the parent chains
 * of a feature, its children per relation, the open work behind each, and what may be created under it. Pure and lazy:
 * everything is computed from the device through two reads (`sheetInput`, `availableTasks`) when asked, and memoised per
 * graph. A graph is built per read of the device (when features changed), never over all features (R14).
 *
 * v3 had a relation catalog (parent workflow, child workflow, name). v4 has edges: a relation is an edge `from` the child
 * `to` the parent, named by the child's relation or reference property. So a **group** is "the features of type T that
 * point at this one through relation R" (key `T.R`), and a parent chain follows the edges that leave a feature. The one
 * set `hierarchyGroups` says which edges count: only those a parent type declares as its child list (`inverse_of: <childType>.<relation>`), as v3's explicit relation catalogue did. Plain lookups (Baum.art) and derived spatial edges are never parents.
 */
import { localize } from '@ueberblick/core/locale';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId, Instant, Key } from '@ueberblick/core/model';
import type { LifecycleState } from '@ueberblick/core/registry';
import type { FeatureSheetInput } from '@ueberblick/ui';
import type { Locale } from '../../messages';

/** What the graph reads of the device (the reader's two calls). */
export interface NavSource {
  sheetInput(id: FeatureId, locale?: string): FeatureSheetInput | undefined;
  availableTasks(id: FeatureId): readonly Key[];
}

export interface NavDeps {
  readonly source: NavSource;
  readonly file: CompiledConfig['file'];
  readonly locale: Locale;
}

/** One hop of a parent chain: `parent` is reached from the level below through the group `group` of the parent. */
export interface Hop {
  readonly parent: FeatureId;
  readonly group: string;
}

/** What a path segment or list row shows for one feature. */
export interface Summary {
  readonly id: FeatureId;
  readonly label: string;
  readonly typeLabel: string;
  /** The current stage's label ('' when the type has no process). */
  readonly stageName: string;
  readonly updatedAt: Instant | undefined;
}

/** A task that creates a child under the feature, with the child type's name for "{name} anlegen". */
export interface CreateOffer {
  readonly task: Key;
  readonly name: string;
}

/** One of a feature's own relations, for the ⌄ menu. */
export interface OwnGroup {
  readonly key: string;
  readonly name: string;
  readonly count: number;
  readonly create: CreateOffer | undefined;
}

export interface RelationNav {
  chains(id: FeatureId): readonly (readonly Hop[])[];
  groups(id: FeatureId): readonly OwnGroup[];
  children(parent: FeatureId, group: string): readonly FeatureId[];
  groupName(parent: FeatureId, group: string): string;
  summary(id: FeatureId): Summary | undefined;
  isFinished(id: FeatureId): boolean;
  /** The feature or any feature below it has a task for this participant that advances it. */
  leadsToOpenWork(id: FeatureId): boolean;
  /** How many direct children of one group (or of all groups) lead to open work: the indicator count. */
  openWork(parent: FeatureId, group?: string): number;
  /** The tasks that create a child in a group of `id` (v3 puts creating there, not in the action row). */
  createTasks(id: FeatureId): ReadonlySet<Key>;
  /** The create offer of one group of `id`. */
  offer(id: FeatureId, group: string): CreateOffer | undefined;
}

/** Guards against cyclic or pathological link data (v3 `relation-graph.ts` MAX_DEPTH, MAX_CHAINS). */
export const MAX_DEPTH = 8;
export const MAX_CHAINS = 6;
const MAX_VISITED = MAX_DEPTH * 4;
const ACTIVE: LifecycleState = 'active';

/** Which edges make a parent-child pair. The seam for narrowing it (e.g. to picked references only). */
const declared = new WeakMap<CompiledConfig['file'], ReadonlySet<string>>();
/** The groups (`<childType>.<relation>`) some type declares as its child list through `inverse_of`; once per config. */
export function hierarchyGroups(file: CompiledConfig['file']): ReadonlySet<string> {
  let set = declared.get(file);
  if (set === undefined) {
    set = new Set(
      Object.values(file.types ?? {}).flatMap((t) =>
        Object.values(t.relations ?? {}).flatMap((r) => (r.inverse_of === undefined ? [] : [r.inverse_of])),
      ),
    );
    declared.set(file, set);
  }
  return set;
}

const groupKey = (childType: Key, relation: Key): string => `${childType}.${relation}`;
const typeOfGroup = (group: string): Key => group.slice(0, group.indexOf('.')) as Key;
const relationOfGroup = (group: string): Key => group.slice(group.indexOf('.') + 1) as Key;

export function createRelationNav(deps: NavDeps): RelationNav {
  const { source, file, locale } = deps;
  const types = file.types ?? {};
  const hierarchy = hierarchyGroups(file);
  const tasks = file.tasks ?? {};
  const local = (v: Parameters<typeof localize>[0]): string => localize(v, [locale]);

  const inputs = new Map<FeatureId, FeatureSheetInput | undefined>();
  const input = (id: FeatureId): FeatureSheetInput | undefined => {
    if (!inputs.has(id)) inputs.set(id, source.sheetInput(id, locale));
    return inputs.get(id);
  };
  const typeLabel = (type: Key): string => local(types[type]?.label) || type;

  /** The name of a group seen from its parent: the parent's declared inverse relation, else the child type's name. */
  function nameOf(parentType: Key | undefined, group: string): string {
    const relations = parentType === undefined ? {} : (types[parentType]?.relations ?? {});
    const declared = Object.values(relations).find((r) => r.inverse_of === group);
    const named = declared?.label === undefined ? '' : local(declared.label);
    return named !== '' ? named : typeLabel(typeOfGroup(group));
  }

  /** The children of a feature by group, from the edges that arrive at it. */
  const childMemo = new Map<FeatureId, Map<string, FeatureId[]>>();
  function childrenByGroup(id: FeatureId): Map<string, FeatureId[]> {
    const cached = childMemo.get(id);
    if (cached !== undefined) return cached;
    const out = new Map<string, FeatureId[]>();
    const here = input(id);
    for (const e of here?.edgesIn ?? []) {
      const other = here?.lookups.feature(e.from);
      if (other === undefined) continue;
      const key = groupKey(other.type, e.relation);
      if (!hierarchy.has(key)) continue;
      const list = out.get(key) ?? [];
      if (!list.includes(e.from)) list.push(e.from);
      out.set(key, list);
    }
    childMemo.set(id, out);
    return out;
  }

  /** A step that sets `relation` to `self`: the task links what it creates to the feature it runs on. */
  const isSelf = (value: unknown): boolean => typeof value === 'string' && value.trim() === 'self';
  const linksToSelf = (
    task: { readonly then?: readonly { readonly set?: Record<string, unknown> | undefined }[] | undefined },
    relation: string,
  ): boolean => (task.then ?? []).some((s) => isSelf(s.set?.[relation]));

  const available = new Map<FeatureId, readonly Key[]>();
  const availableOf = (id: FeatureId): readonly Key[] => {
    let list = available.get(id);
    if (list === undefined) {
      list = source.availableTasks(id);
      available.set(id, list);
    }
    return list;
  };

  /** The create task of a group: available on this feature, creates the child type, and sets the relation to `self`. */
  function offerFor(id: FeatureId, group: string): CreateOffer | undefined {
    const childType = typeOfGroup(group);
    for (const key of availableOf(id)) {
      const task = tasks[key];
      if (task?.creates === childType && linksToSelf(task, relationOfGroup(group)))
        return { task: key, name: typeLabel(childType) };
    }
    return undefined;
  }

  /** Every group a create task of this feature offers, even with no child yet. */
  function creatableGroups(id: FeatureId): string[] {
    const out: string[] = [];
    for (const key of availableOf(id)) {
      const task = tasks[key];
      if (task?.creates === undefined) continue;
      for (const step of task.then ?? []) {
        for (const [relation, value] of Object.entries(step.set ?? {})) {
          if (isSelf(value)) out.push(groupKey(task.creates as Key, relation as Key));
        }
      }
    }
    return out;
  }

  const finishedMemo = new Map<FeatureId, boolean>();
  function isFinished(id: FeatureId): boolean {
    const cached = finishedMemo.get(id);
    if (cached !== undefined) return cached;
    const i = input(id);
    let finished = true;
    if (i !== undefined) {
      const stage = i.type.process?.property;
      const value = stage === undefined ? undefined : i.feature.properties[stage];
      finished =
        i.feature.lifecycle !== ACTIVE ||
        (typeof value === 'string' && (i.type.process?.end.some((e) => e === value) ?? false));
    }
    finishedMemo.set(id, finished);
    return finished;
  }

  /** The stage properties of all types: a bound feature's stage (`tree.stage`) is advanced by a task on another type. */
  const stageProperties = new Set(
    Object.values(types).flatMap((t) => (t.process === undefined ? [] : [t.process.property as string])),
  );
  /** A task advances the case when it writes the stage, its own or a bound feature's, or the lifecycle (v3 `advancesCase`). */
  const advances = (taskKey: Key, stage: string | undefined): boolean => {
    const task = tasks[taskKey];
    if (task === undefined) return false;
    if (stage !== undefined && task.form !== undefined && stage in task.form) return true;
    return (task.then ?? []).some(
      (s) =>
        s.lifecycle !== undefined ||
        Object.keys(s.set ?? {}).some((key) =>
          key.includes('.') ? stageProperties.has(key.slice(key.lastIndexOf('.') + 1)) : key === stage,
        ),
    );
  };

  const ownMemo = new Map<FeatureId, boolean>();
  function hasOwnOpenWork(id: FeatureId): boolean {
    const cached = ownMemo.get(id);
    if (cached !== undefined) return cached;
    const stage = input(id)?.type.process?.property;
    const result = !isFinished(id) && availableOf(id).some((t) => advances(t, stage));
    ownMemo.set(id, result);
    return result;
  }

  const leadsMemo = new Map<FeatureId, boolean>();
  function leads(id: FeatureId, visiting: Set<FeatureId>): boolean {
    const cached = leadsMemo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id) || visiting.size > MAX_VISITED) return false;
    visiting.add(id);
    let result = hasOwnOpenWork(id);
    if (!result) {
      for (const kids of childrenByGroup(id).values()) {
        if (kids.some((k) => leads(k, visiting))) {
          result = true;
          break;
        }
      }
    }
    visiting.delete(id);
    leadsMemo.set(id, result);
    return result;
  }

  const groupsOf = (id: FeatureId): readonly OwnGroup[] => {
    const type = input(id)?.feature.type;
    const keys = new Set<string>([...childrenByGroup(id).keys(), ...creatableGroups(id)]);
    const rows = [...keys].map((key) => ({
      key,
      name: nameOf(type, key),
      count: childrenByGroup(id).get(key)?.length ?? 0,
      create: offerFor(id, key),
    }));
    // Two groups with one name (a picked and a derived relation from the same type): say which relation it is.
    const dup = new Set(
      rows.filter((r, i) => rows.findIndex((o) => o.name === r.name) !== i).map((r) => r.name),
    );
    const collator = new Intl.Collator(locale);
    return rows
      .map((r) => {
        if (!dup.has(r.name)) return r;
        const childType = types[typeOfGroup(r.key)];
        const relation = relationOfGroup(r.key);
        const label = childType?.properties[relation]?.label ?? childType?.relations?.[relation]?.label;
        return { ...r, name: `${r.name} (${label === undefined ? relation : local(label)})` };
      })
      .sort((a, b) => collator.compare(a.name, b.name));
  };

  return {
    chains(id) {
      const out: Hop[][] = [];
      const walk = (at: FeatureId, path: readonly Hop[], seen: Set<FeatureId>): void => {
        if (out.length >= MAX_CHAINS) return;
        const i = input(at);
        const parents = (i?.edgesOut ?? []).filter(
          (e) => i !== undefined && hierarchy.has(groupKey(i.feature.type, e.relation)) && !seen.has(e.to),
        );
        if (i === undefined || parents.length === 0 || path.length >= MAX_DEPTH) {
          if (path.length > 0) out.push([...path].reverse());
          return;
        }
        for (const e of parents) {
          seen.add(e.to);
          walk(e.to, [...path, { parent: e.to, group: groupKey(i.feature.type, e.relation) }], seen);
          seen.delete(e.to);
        }
      };
      walk(id, [], new Set([id]));
      return out;
    },
    groups: groupsOf,
    children: (parent, group) => childrenByGroup(parent).get(group) ?? [],
    groupName: (parent, group) => nameOf(input(parent)?.feature.type, group),
    summary(id) {
      const i = input(id);
      if (i === undefined) return undefined;
      const stage = i.type.process?.property;
      const value = stage === undefined ? undefined : i.feature.properties[stage];
      const option =
        stage === undefined || typeof value !== 'string'
          ? undefined
          : i.type.properties[stage]?.options?.[value];
      return {
        id,
        label: i.lookups.feature(id)?.label ?? id,
        typeLabel: local(i.type.label),
        stageName: option === undefined ? (typeof value === 'string' ? value : '') : local(option),
        updatedAt: i.updatedAt ?? i.feature.changedAt,
      };
    },
    isFinished,
    leadsToOpenWork: (id) => leads(id, new Set()),
    openWork(parent, group) {
      const by = childrenByGroup(parent);
      const kids = group === undefined ? [...by.values()].flat() : (by.get(group) ?? []);
      return new Set(kids.filter((k) => leads(k, new Set()))).size;
    },
    createTasks: (id) =>
      new Set(groupsOf(id).flatMap((g) => (g.create === undefined ? [] : [g.create.task]))),
    offer: offerFor,
  };
}

/**
 * The features the map shows while this feature's sheet is open (v3 `onFocusRelation`, Module :447-455): the children of
 * the open relation, else the siblings through the relation this feature was reached by (the last hop of the chosen
 * chain); `null` when there is nothing to focus.
 */
export function focusOf(
  nav: RelationNav,
  id: FeatureId,
  openGroup: string | undefined,
  chain: readonly Hop[] | undefined,
): readonly FeatureId[] | null {
  if (openGroup !== undefined) return nav.children(id, openGroup);
  const hop = chain?.at(-1);
  return hop === undefined ? null : nav.children(hop.parent, hop.group);
}
