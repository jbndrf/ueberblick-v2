/**
 * The edge `when` of an automatic action (A-045, docs/06 "Edge trigger"): fires for a feature when its expression was false
 * before a run (or the feature did not exist) and is true after it. Nothing is stored: the "before" view is the
 * overlay with the run's changes undone, so the rule re-arms by itself when the expression turns false again.
 * Only the features a run touched are judged, never all features (R14).
 */
import { condition } from '../expr/evaluate';
import type { EvalContext, EvalValue } from '../expr/contract';
import type { Bbox } from '../geo/contract';
import { edgeKey } from '../fold/edge-key';
import type { Edge, FeatureId, FeatureState, Json, Key, RecordedObservation, RunId } from '../model';
import type { Facts } from '../ports';
import { autoPath, type Auto } from '../schema/compile/autos';
import { kp } from '../schema/compile/kp';
import type { TypedAst } from '../expr/check/check';
import { taskTypes } from '../schema/compile/indexes';
import { featureAccess } from './access';
import type { Change } from './overlay';
import { envAt } from './resolve';
import { evalContext, ref, type Env } from './scope';
import type { Actor } from '../model';

/** What a run did to the edges: the ones it added (absent before) and the ones it removed (present before). */
interface EdgeDelta {
  readonly added: readonly Edge[];
  readonly removed: readonly Edge[];
}

/** The facts as they were before a run: the touched features and the run's edge changes undone, the rest untouched. */
class BeforeFacts implements Facts {
  private readonly undone = new Map<FeatureId, FeatureState | undefined>();

  constructor(
    private readonly now: Facts,
    changes: readonly Change[],
    created: ReadonlySet<FeatureId>,
    private readonly edges: EdgeDelta,
  ) {
    for (const id of new Set(changes.map((c) => c.featureId))) {
      const f = now.feature(id);
      if (f === undefined || created.has(id)) {
        this.undone.set(id, undefined);
        continue;
      }
      // The first change of a property carries its value before the run (`undefined`: it had none).
      const first = new Map<string, Json | undefined>();
      for (const c of changes)
        if (c.featureId === id && !first.has(c.property)) first.set(c.property, c.before);
      const properties: Record<string, Json> = {};
      for (const [k, v] of Object.entries(f.properties)) if (!first.has(k)) properties[k] = v;
      for (const [k, v] of first) if (v !== undefined) properties[k] = v;
      this.undone.set(id, { ...f, properties });
    }
  }

  feature(id: FeatureId): FeatureState | undefined {
    return this.undone.has(id) ? this.undone.get(id) : this.now.feature(id);
  }
  near(type: Key, bbox: Bbox): Iterable<FeatureState> {
    return this.now.near(type, bbox);
  }
  ofType(type: Key): Iterable<FeatureState> {
    return this.now.ofType(type);
  }
  edgesFrom(id: FeatureId, relation?: Key): readonly Edge[] {
    return this.undoEdges(
      this.now.edgesFrom(id, relation),
      (e) => e.from === id && (relation === undefined || e.relation === relation),
    );
  }
  edgesTo(id: FeatureId, relation?: Key): readonly Edge[] {
    return this.undoEdges(
      this.now.edgesTo(id, relation),
      (e) => e.to === id && (relation === undefined || e.relation === relation),
    );
  }
  /** Without the edges the run added, with the ones it removed; only the run's own delta is read, never a scan (R14). */
  private undoEdges(now: readonly Edge[], mine: (e: Edge) => boolean): readonly Edge[] {
    if (this.edges.added.length === 0 && this.edges.removed.length === 0) return now;
    const added = new Set(this.edges.added.map(edgeKey));
    return [...now.filter((e) => !added.has(edgeKey(e))), ...this.edges.removed.filter(mine)];
  }
  history(id: FeatureId, property: string, limit: number): readonly RecordedObservation[] {
    return this.now.history(id, property, limit);
  }
  observationsByActor(actorId: string): readonly RecordedObservation[] {
    return this.now.observationsByActor(actorId);
  }
  createdBy(actorId: string, limit: number): number {
    return this.now.createdBy(actorId, limit);
  }
  featuresWith(type: Key, property: string, value: Json): Iterable<FeatureState> {
    return this.now.featuresWith(type, property, value);
  }
}

/** The compiled conditions of an edge entry: the task's `when` and the entry's `when`, each when present. */
function edgeConditions(config: Env['config'], auto: Auto): readonly TypedAst[] {
  const paths = [
    kp('tasks', auto.task, 'when'),
    ...(auto.entry.when === undefined ? [] : [autoPath(auto, 'when')]),
  ];
  return paths.flatMap((p) => {
    const c = config.expressions.get(p);
    return c === undefined ? [] : [c.typed];
  });
}

export interface WhenVerdict {
  readonly rule: string;
  readonly subject: FeatureId;
  /** `edge`: false → true, fire. `held`: true before and after, already fired. Neither: false after, not reported. */
  readonly kind: 'edge' | 'held';
}

/** Judges every automatic action without a timing on every feature the run touched (`changes`, plus the ones it `created`). */
export function judgeWhenRules(
  env: Env,
  actor: Actor,
  runId: RunId,
  changes: readonly Change[],
  created: readonly FeatureId[],
): readonly WhenVerdict[] {
  const rules = env.config.autosByTrigger.get('when');
  if (rules === undefined || rules.length === 0) return [];
  const edges = env.overlay.edgeDelta(runId);
  // A feature is touched by a property change, by being created, or by gaining or losing an edge (its relations changed).
  const ends = [...edges.added, ...edges.removed].flatMap((e) => [e.from, e.to]);
  const touched = [...new Set([...changes.map((c) => c.featureId), ...created, ...ends])];
  const createdSet = new Set(created);
  const before = new BeforeFacts(env.overlay, changes, createdSet, edges);
  const out: WhenVerdict[] = [];
  for (const id of touched) {
    const view = envAt(env, id);
    const type = env.overlay.feature(id)?.type;
    for (const key of rules) {
      const auto = view.config.autos.get(key);
      if (auto === undefined || auto.kind !== 'edge') continue;
      const types = taskTypes(view.config.file.tasks?.[auto.task] ?? { on: [] });
      if (types.length > 0 && (type === undefined || !types.includes(type))) continue;
      // The one shared `when` of the task, ANDed with the entry's own (C-004 step 3).
      const typed = edgeConditions(view.config, auto);
      const vars = new Map<string, EvalValue>([['self', ref(id)]]);
      const after = evalContext(view, actor, vars);
      const holds = (c: EvalContext): boolean => typed.every((t) => condition(t, c).value);
      if (!holds(after)) continue;
      const was: EvalContext = { ...after, features: featureAccess(before, view.config) };
      out.push({ rule: key, subject: id, kind: holds(was) ? 'held' : 'edge' });
    }
  }
  return out;
}
