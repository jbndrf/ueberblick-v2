/** Seeds the instance a v3 run saw as a v4 feature (with related features), through the conversion mapping. */
import type { CompiledConfig, FeatureId, Json, RunId } from '@ueberblick/core';
import type { MemoryStore } from '@ueberblick/core/memory';
import type { Mapping, TypeMapping } from '../config/convert';
import { slug } from '../config/keys';
import type { V3Instance, V3Run, V3Value } from './types';
import { toV4 } from './values';

/** Seed one feature as an import would (no task, no permissions). */
export function seedFeature(
  store: MemoryStore,
  id: FeatureId,
  type: string,
  properties: Readonly<Record<string, Json>>,
  runId: RunId,
): void {
  store.append(runId, [
    { featureId: id, property: '$type', result: type },
    ...Object.entries(properties).map(([property, result]) => ({ featureId: id, property, result })),
  ]);
}

export interface SeedEnv {
  readonly mapping: Mapping;
  readonly config: CompiledConfig;
  readonly world: MemoryStore;
  readonly newId: () => FeatureId;
  readonly runId: RunId;
}

export interface Seeded {
  /** Every feature that was created (to be removed after the replay). */
  readonly ids: FeatureId[];
  /** The instance the run acts on; absent for an entry task. */
  readonly self?: FeatureId;
  /** Set when the instance cannot be seeded; the run is then not replayable. */
  readonly missing?: string;
}

const ORIGIN = { type: 'Point', coordinates: [0, 0] } as const;

/** The v4 properties for a v3 record: stage, status, creator, geometry and the values of its fields. */
function properties(
  type: TypeMapping,
  i: { stage?: string; status?: string; createdBy?: string; values?: Readonly<Record<string, V3Value>> },
): { props: Record<string, Json>; missing?: string } {
  const props: Record<string, Json> = {};
  if (type.geometry !== undefined) props[type.geometry] = ORIGIN;
  if (i.stage !== undefined && type.stage !== undefined) {
    const key = type.stage.options[i.stage];
    if (key === undefined)
      return { props, missing: `stage "${i.stage}" of ${type.type} is not in the converted project` };
    props[type.stage.property] = key;
  }
  if (i.status !== undefined && type.lifecycle !== undefined) props[type.lifecycle] = slug(i.status, 's');
  if (i.createdBy !== undefined && type.creator !== undefined) props[type.creator] = i.createdBy;
  for (const [field, v] of Object.entries(i.values ?? {})) {
    const p = type.properties[field];
    if (p === undefined)
      return { props, missing: `field "${field}" of ${type.type} is not in the converted project` };
    if (p.type === 'reference') continue;
    const value = toV4(p, v);
    if (value === undefined) {
      return { props, missing: `value ${JSON.stringify(v)} of field "${field}" has no v4 counterpart` };
    }
    if (value !== null) props[p.property] = value;
  }
  return { props };
}

export function seedInstance(run: V3Run, type: TypeMapping, env: SeedEnv): Seeded {
  const ids: FeatureId[] = [];
  const instance: V3Instance | undefined = run.instance;
  if (instance === undefined) return { ids };
  // v3 instances always have a status; without a recorded one it is `active`, the default of a new v4 feature.
  const { props, missing } = properties(type, { ...instance, status: instance.status ?? 'active' });
  if (missing !== undefined) return { ids, missing };
  const self = env.newId();
  ids.push(self);
  const later: (() => void)[] = [];
  for (const [field, children] of Object.entries(instance.related ?? {})) {
    const p = type.properties[field];
    const target =
      p === undefined
        ? undefined
        : (p.inverse?.type ?? env.config.file.types?.[type.type]?.properties[p.property]?.to);
    const childType = Object.values({ ...env.mapping.types, ...env.mapping.tables }).find(
      (t) => t.type === target,
    );
    if (p === undefined || childType === undefined) {
      return { ids, missing: `related field "${field}" is not a reference in the converted project` };
    }
    // a many-valued field is a relation: every child points back at this feature
    if (children.length > 1 && p.inverse === undefined) {
      return {
        ids,
        missing: `"${field}" holds ${children.length} related instances; a v4 reference holds one feature`,
      };
    }
    for (const child of children) {
      const c = properties(childType, child);
      if (c.missing !== undefined) return { ids, missing: c.missing };
      const childId = env.newId();
      ids.push(childId);
      if (p.inverse !== undefined) {
        const back = p.inverse.property;
        later.push(() =>
          seedFeature(env.world, childId, childType.type, { ...c.props, [back]: self }, env.runId),
        );
      } else {
        seedFeature(env.world, childId, childType.type, c.props, env.runId);
        props[p.property] = childId;
      }
    }
  }
  seedFeature(env.world, self, type.type, props, env.runId);
  for (const seed of later) seed();
  return { ids, self };
}
