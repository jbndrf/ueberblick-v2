/** Compares what v3 recorded with what v4's plan did. */
import type { FeatureId, PlanResult } from '@ueberblick/core';
import type { MemoryStore } from '@ueberblick/core/memory';
import type { TypeMapping } from '../config/convert';
import type { DiffKind } from './registry';
import type { V3Run } from './types';
import { sameValue, show, toV4 } from './values';

export interface Found {
  readonly kind: DiffKind;
  readonly v3: string;
  readonly v4: string;
  /** What exactly differs (a field, the refusal code). */
  readonly detail: string;
  /** The refusal code of v4, when it refused. */
  readonly code?: string;
}

export function compareResult(
  run: V3Run,
  result: PlanResult,
  type: TypeMapping,
  world: MemoryStore,
  subject: FeatureId | undefined,
): Found[] {
  const rec = run.recorded;
  if (!result.ok) {
    if (rec.outcome === 'refused') return [];
    return [
      {
        kind: 'outcome',
        v3: 'accepted',
        v4: `refused (${result.refusal.code})`,
        detail: result.refusal.message,
        code: result.refusal.code,
      },
    ];
  }
  if (rec.outcome === 'refused') {
    return [
      {
        kind: 'outcome',
        v3: `refused${rec.reason ? ` (${rec.reason})` : ''}`,
        v4: 'accepted',
        detail: 'v4 accepted the run',
      },
    ];
  }
  const state = subject === undefined ? undefined : world.feature(subject);
  if (state === undefined)
    return [{ kind: 'outcome', v3: 'accepted', v4: 'no feature', detail: 'the run produced no feature' }];
  const found: Found[] = [];
  if (rec.stage !== undefined && type.stage !== undefined) {
    const want = type.stage.options[rec.stage];
    const got = state.properties[type.stage.property];
    if (want !== got) {
      found.push({ kind: 'stage', v3: rec.stage, v4: show(got), detail: `stage after the run` });
    }
  }
  for (const [field, v3Value] of Object.entries(rec.values ?? {})) {
    const p = type.properties[field];
    if (p === undefined) continue;
    const want = toV4(p, v3Value);
    if (want === undefined) continue;
    const got = state.properties[p.property];
    if (!sameValue(want, got)) {
      found.push({
        kind: 'value',
        v3: `${field} = ${show(v3Value)}`,
        v4: `${p.property} = ${show(got)}`,
        detail: field,
      });
    }
  }
  return found;
}
