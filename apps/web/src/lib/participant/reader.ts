/**
 * What the sheets need to know about the world, asked of core and never decided here (R1): which tasks a role may
 * start with no feature, which are offered on a feature, the expression context of a task, and the input of the
 * feature sheet. Everything reads the device's `Facts` (synced state with the predictions of queued runs on top).
 */
import type { EvalContext, EvalValue } from '@ueberblick/core/expr';
import type { Geo } from '@ueberblick/core/geo';
import type {
  Actor,
  FeatureId,
  FeatureState,
  FoldedFeature,
  Instant,
  Key,
  LocalizedString,
} from '@ueberblick/core/model';
import { displayName, localize } from '@ueberblick/core/locale';
import { isRefusedRunState } from '@ueberblick/core/registry';
import { NEW_FEATURE, PLAN_MAX_RULE_DEPTH, createPlan } from '@ueberblick/core/plan';
import { formApi } from '@ueberblick/core/form';
import type { Clock, Facts, Ids } from '@ueberblick/core/ports';
import type { ActivityChange, ActivityEntry, FeatureSheetInput } from '@ueberblick/ui';
import {
  AwaitingConfig,
  createFeatureConfigs,
  type ConfigVersions,
  type DeviceStore,
} from '@ueberblick/client';
import { message } from './messages';
import { localeOf } from './locale-tag';
import { isServed, type Property } from '@ueberblick/core';
import { participantName } from './people';

/** What the Aktivität timeline reads from the device store (WP-602). */
export type ActivitySource = Pick<
  DeviceStore,
  | 'activityWarm'
  | 'warmActivity'
  | 'observationsOf'
  | 'runMeta'
  | 'personName'
  | 'queuedRunsOf'
  | 'plannedChangesOf'
>;

export interface ReaderDeps {
  readonly facts: Facts;
  /**
   * The config versions on the device. A feature is read under its own version (A-029), the same resolver the run
   * queue's planner uses (`createFeatureConfigs`, R1); a create under the deployed one.
   */
  readonly versions: Pick<ConfigVersions, 'get'> & Partial<Pick<ConfigVersions, 'deployed'>>;
  /** The version this session was bootstrapped with: the deployed one until the first sync header names it. */
  readonly bootstrapVersion: number;
  readonly actor: Actor;
  readonly geo: Geo;
  readonly clock: Clock;
  readonly ids: Ids;
  readonly locale: string;
  readonly activity: ActivitySource;
  /** The signed-in participant's own name (bootstrap): own runs always show it. */
  readonly actorName: string;
}

export interface Reader {
  /** Tasks the actor may start with no feature (`$map` and `$none` offers), in config order. */
  startableTasks(): readonly string[];
  /** Tasks offered on a feature to the actor, in config order (core.plan). */
  availableTasks(feature: FeatureId): readonly Key[];
  /**
   * The config version a feature follows when that version is not on the device yet (it is being fetched), else
   * `undefined`. Then the sheet shows the feature read-only and `availableTasks` is empty, like the run queue, which
   * holds a run as `awaiting_config` until its version arrives (docs/07, `engine.ts`).
   */
  awaitingVersion(feature: FeatureId): number | undefined;
  /** The expression context of a task: `self` (when it has a target), `actor`, `now`. */
  taskContext(self?: FeatureId): EvalContext;
  /** The binds of a task for a target, by name (`null`: no Objekt the actor may see); core.plan resolves them like `scope()` (A5). */
  taskBinds(task: Key, self?: FeatureId): ReadonlyMap<string, EvalValue>;
  /** The input of the feature sheet, or undefined when the feature is not on this device. */
  sheetInput(feature: FeatureId, locale?: string): FeatureSheetInput | undefined;
  /**
   * The Aktivität timeline of a feature: one entry per run (the synced runs, then the device's own pending and
   * refused ones on top), newest first. Needs `warmActivity` first (throws `history_not_warm` otherwise).
   */
  activityOf(feature: FeatureId, locale?: string): readonly ActivityEntry[];
  /** Loads what `activityOf` reads. Call before opening a feature's sheet. */
  warmActivity(feature: FeatureId): Promise<void>;
  /** The display name of a feature (core `displayName`, the one the list and the sheet header use). */
  /** `via`: the reference property the name is shown for; its Anzeigefeld (`display_property`, A-048) wins. */
  labelOf(state: FeatureState, locale?: string, via?: Pick<Property, 'display_property'>): string;
}

export function createReader(deps: ReaderDeps): Reader {
  const { facts, actor, geo, clock, activity, actorName: ownName } = deps;
  /** The language the device opened in; every read may name the live one instead (the person can switch it). */
  const openLocale = deps.locale;
  const people = { selfId: actor.id, selfName: ownName, personName: (id: string) => activity.personName(id) };
  const configs = createFeatureConfigs({ versions: deps.versions, facts, fallback: deps.bootstrapVersion });
  const plan = createPlan(formApi);
  const ports = { clock, ids: deps.ids, facts, geo, limits: { ruleDepth: PLAN_MAX_RULE_DEPTH } };
  /** What a feature is shown under: its own version, else (while that is fetched) the deployed one. */
  const shownUnder = (id: FeatureId | typeof NEW_FEATURE) => {
    const r = configs.of(id) ?? configs.of(NEW_FEATURE);
    if (r === undefined) throw new Error('No config version of this project is readable on the device.');
    return r.config;
  };
  const typesOf = (id: FeatureId) => shownUnder(id).file.types ?? {};

  const labelOf = (
    state: FeatureState,
    locale: string = openLocale,
    via?: Pick<Property, 'display_property'>,
  ): string => displayName(typesOf(state.id)[state.type], state, [locale], via);

  /** A run's task label: tasks of the feature's version, else the deployed one. */
  const taskLabel = (key: string, id: FeatureId, locale: string): string => {
    const label = shownUnder(id).file.tasks?.[key]?.label;
    return label === undefined ? key : localize(label, [locale]);
  };
  const actorLabel = (id: string | null, locale: string): string => {
    const neutral = message(localeOf(locale), 'activity_unknown_actor');
    return id === null ? neutral : (participantName(people, id) ?? neutral);
  };
  const iso = (ms: number): Instant => new Date(ms).toISOString() as Instant;

  /** A refused run's values: its input entries that are properties of the feature's type (a form field key is a property key). */
  const queuedChanges = (input: Record<string, unknown>, feature: FeatureId): readonly ActivityChange[] => {
    const state = facts.feature(feature);
    const properties = state === undefined ? undefined : typesOf(feature)[state.type]?.properties;
    return Object.entries(input).flatMap(([property, result]) =>
      properties?.[property] === undefined ? [] : [{ property: property as Key, result: result as never }],
    );
  };

  function activityOf(id: FeatureId, locale: string = openLocale): readonly ActivityEntry[] {
    const byRun = new Map<string, ActivityChange[]>();
    // `observationsOf` is newest first; a run's changes are listed in the order the fold applies them (oldest seq
    // first), so that the last write of a property, e.g. the stage a `then` step moved on to, is the last change.
    for (const o of [...activity.observationsOf(id)].reverse()) {
      const list = byRun.get(o.runId) ?? [];
      list.push({ property: o.property as Key, result: o.result });
      byRun.set(o.runId, list);
    }
    const synced = [...byRun]
      .flatMap(([runId, changes]) => {
        const meta = activity.runMeta(runId as never);
        return meta === undefined ? [] : [{ meta, changes }];
      })
      .sort((a, b) => b.meta.seq - a.meta.seq)
      .map(({ meta, changes }): ActivityEntry => ({
        runId: meta.id,
        task: taskLabel(meta.task, id, locale),
        actorLabel: actorLabel(meta.actor, locale),
        // The server receive time, like the feature's audit times (WP-794, M8 = b): the creating run is the one made at
        // the feature's `createdAt` (ui `feature-sheet/activity.ts`), which is now the receive time too.
        at: iso(meta.receivedAt),
        status: 'accepted',
        changes,
      }));
    const own = activity
      .queuedRunsOf(id)
      .filter((q) => !byRun.has(q.run.id))
      .sort((a, b) => b.order - a.order)
      .map((q): ActivityEntry => ({
        runId: q.run.id,
        task: taskLabel(q.run.task, id, locale),
        actorLabel: actorLabel(q.run.actor.id, locale),
        at: q.run.clientTime ?? clock.now(),
        status: isRefusedRunState(q.state) ? 'refused' : 'pending',
        // a waiting run: what the device's plan wrote (the stage move, rule-set fields), like a synced entry;
        // a refused one has no plan, so the input the user typed is what it can show
        changes: isRefusedRunState(q.state)
          ? queuedChanges(q.run.input, id)
          : activity
              .plannedChangesOf(q.run.id, id)
              .map((c) => ({ property: c.property as Key, result: c.result as never })),
      }));
    return [...own, ...synced];
  }

  /** Tasks offered on a feature: none while its version is not on the device (or a related feature's is not). */
  const tasksOn = (feature: FeatureId): readonly Key[] => {
    if (configs.of(feature) === undefined) return [];
    try {
      return plan.availableTasksFor(feature, actor, configs.configFor, ports);
    } catch (e) {
      if (e instanceof AwaitingConfig) return [];
      throw e;
    }
  };

  return {
    startableTasks() {
      const deployed = configs.of(NEW_FEATURE);
      if (deployed === undefined) return [];
      const one = () => deployed;
      return Object.keys(deployed.config.file.tasks ?? {}).filter(
        (t) =>
          plan.availableFor(t as Key, { map: true }, actor, one, ports).ok ||
          plan.availableFor(t as Key, { none: true }, actor, one, ports).ok,
      );
    },

    availableTasks: tasksOn,

    awaitingVersion: (feature) =>
      configs.of(feature) === undefined ? configs.versionFor(feature) : undefined,

    taskContext(self) {
      // core.plan's guarded context (the one `scope()` reads through): an Objekt the actor may not see reads as absent (WP-816).
      const target = self === undefined ? { none: true as const } : { feature: self };
      return plan.contextFor(target, actor, configs.configFor, ports);
    },

    taskBinds(task, self) {
      const target = self === undefined ? { none: true as const } : { feature: self };
      return plan.bindsFor(task, target, actor, configs.configFor, ports);
    },

    sheetInput(id, locale = openLocale) {
      const state = facts.feature(id);
      const config = shownUnder(id);
      const types = config.file.types ?? {};
      const type = state === undefined ? undefined : types[state.type];
      if (state === undefined || type === undefined || !isServed(state.lifecycle)) return undefined;
      const derived: Record<string, ReturnType<Geo['derive']>> = {};
      for (const [key, property] of Object.entries(type.properties)) {
        const v = state.properties[key];
        if (property.type === 'geometry' && typeof v === 'object' && v !== null && !Array.isArray(v))
          derived[key] = geo.derive(v as never);
      }
      const feature: FoldedFeature = { ...state, derived };
      const taskLabels: Record<string, LocalizedString> = {};
      for (const [key, task] of Object.entries(config.file.tasks ?? {})) taskLabels[key] = task.label;
      return {
        feature,
        type,
        types,
        availableTasks: tasksOn(id),
        taskLabels,
        edgesOut: facts.edgesFrom(id),
        edgesIn: facts.edgesTo(id),
        // A cold feature has no activity yet: the Aktivität tab warms it (`warmActivity`) before it opens.
        activity: activity.activityWarm(id) ? activityOf(id, locale) : [],
        lookups: {
          participant: (who) => participantName(people, who),
          role: (key) => {
            const label = config.file.roles?.[key]?.label;
            return label === undefined ? undefined : localize(label, [locale]);
          },
          feature: (other) => {
            const s = facts.feature(other);
            return s === undefined ? undefined : { label: labelOf(s, locale), type: s.type };
          },
        },
        locale,
      };
    },

    activityOf,
    warmActivity: (id) => activity.warmActivity(id),
    labelOf,
  };
}
