/** A recorded v3 run as a v4 run (actor roles, form input and, for an entry task, the geometry). */
import type { Actor, FeatureId, Json, Key, Run, RunId } from '@ueberblick/core';
import type { Mapping, TypeMapping } from '../config/convert';
import { slug } from '../config/keys';
import type { V3Run } from './types';
import { toV4 } from './values';

const ORIGIN: Json = { type: 'Point', coordinates: [0, 0] };

export function buildRun(
  run: V3Run,
  type: TypeMapping,
  mapping: Mapping,
  task: string,
  id: RunId,
  self: FeatureId | undefined,
): { run: Run } | { missing: string } {
  const actor: Actor = {
    id: run.actor.id,
    kind: 'participant',
    roles: run.actor.roles.map((r) => (mapping.roles[r] ?? slug(r)) as Key),
  };
  const input: Record<string, Json> = {};
  for (const [field, v] of Object.entries(run.input ?? {})) {
    const p = type.properties[field];
    if (p === undefined) return { missing: `input field "${field}" is not in the converted project` };
    const value = toV4(p, v);
    if (value === undefined)
      return { missing: `input ${JSON.stringify(v)} for "${field}" has no v4 counterpart` };
    if (value !== null) input[p.property] = value;
  }
  if (type.geometry !== undefined && (run.geometry !== undefined || run.instance === undefined)) {
    input[type.geometry] = (run.geometry ?? ORIGIN) as Json;
  }
  return {
    run: {
      id,
      task: task as Key,
      actor,
      configVersion: 1,
      input,
      ...(self !== undefined ? { featureId: self } : {}),
    },
  };
}
