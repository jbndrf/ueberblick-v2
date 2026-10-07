// WP-854: a prediction keeps what the run's plan wrote (the one plan), rule runs included, in plan order.
import { createGeo } from '@ueberblick/core/geo';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Key, Run, RunId, FeatureId } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import type { PlannedRun } from '@ueberblick/core/plan';
import { describe, expect, it } from 'vitest';
import { createPredictor } from './predict';

const baum = 'baum' as Key;
const tree = 'f1' as FeatureId;
const config = {
  foldTypes: new Map([[baum, { geometryProperties: [], references: [], derived: [], stage: undefined }]]),
} as unknown as CompiledConfig;
const facts = { feature: () => undefined } as unknown as Facts;
const run = (id: string, causedBy?: string) => ({ id, ...(causedBy ? { causedBy } : {}) }) as unknown as Run;
const obs = (property: string, result: unknown) =>
  ({ featureId: tree, property, result, type: baum }) as never;

describe('predict keeps the planned observations', () => {
  it('per submitted run, in plan order, with the observations of the rule runs it caused', () => {
    const planned = [
      { run: run('r1'), observations: [obs('vitalitaet', 'v4'), obs('befund', 'x')] },
      { run: run('r2', 'r1'), observations: [obs('stage', 'massnahme')] },
      { run: run('r3'), observations: [obs('befund', 'y')] },
    ] as unknown as PlannedRun[];
    const out = createPredictor(createGeo())(() => config, facts, planned);
    expect(out.map((p) => p.runId)).toEqual(['r1' as RunId, 'r3' as RunId]);
    expect(out[0]?.observations.map((o) => [o.property, o.result])).toEqual([
      ['vitalitaet', 'v4'],
      ['befund', 'x'],
      ['stage', 'massnahme'],
    ]);
    expect(out[0]?.observations[0]).toEqual({ featureId: tree, property: 'vitalitaet', result: 'v4' });
    expect(out[1]?.observations).toHaveLength(1);
  });
});
